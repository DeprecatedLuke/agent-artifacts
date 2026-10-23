<script lang="ts">
import { ApiError } from "../lib/api";
import { theme } from "../lib/theme.svelte";
import Icon from "./Icon.svelte";

interface Props {
	src: string;
	rev: number;
	loadBody?: (rev: number) => Promise<string>;
	reloadSrc?: () => Promise<string>;
	title?: string;
}

let { src, rev, loadBody, reloadSrc, title = "Report" }: Props = $props();

let activeSrc = $state("");
let ready = $state(false);
let appliedRev = $state(0);
let error = $state<string | null>(null);
let iframe = $state<HTMLIFrameElement | undefined>(undefined);

let ackTimer: number | undefined;
let pendingRev: number | null = null;
let generation = 0;

function clearAck(): void {
	if (ackTimer !== undefined) window.clearTimeout(ackTimer);
	ackTimer = undefined;
}

// A new document URL (cap rotation, report switch) starts from scratch.
$effect(() => {
	const next = src;
	if (next !== activeSrc) {
		activeSrc = next;
		ready = false;
		appliedRev = 0;
		error = null;
	}
});

function post(message: Record<string, unknown>): void {
	iframe?.contentWindow?.postMessage({ source: "artifacts", ...message }, "*");
}

function postTheme(): void {
	post({ type: "theme", scheme: theme.scheme });
}

// Keep the sandboxed document in sync with the parent's resolved theme.
$effect(() => {
	const scheme = theme.scheme;
	const frame = iframe;
	if (!frame) return;
	frame.style.colorScheme = scheme;
	if (ready) postTheme();
});

// Push live updates whenever the report revision moves ahead of the document.
$effect(() => {
	const target = rev;
	const isReady = ready;
	const applied = appliedRev;
	if (!isReady || !loadBody || target <= applied) return;
	void applyUpdate(target);
});

async function applyUpdate(target: number): Promise<void> {
	const loader = loadBody;
	if (!loader) return;
	const ticket = ++generation;
	try {
		const html = await loader(target);
		if (ticket !== generation) return;
		pendingRev = target;
		post({ type: "update", rev: target, html });
		clearAck();
		ackTimer = window.setTimeout(() => {
			ackTimer = undefined;
			if (pendingRev === target) {
				pendingRev = null;
				void reload();
			}
		}, 3000);
	} catch (err) {
		if (ticket !== generation) return;
		if (err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 410)) {
			await reload();
			return;
		}
		error = err instanceof Error ? err.message : String(err);
	}
}

async function reload(): Promise<void> {
	clearAck();
	pendingRev = null;
	ready = false;
	generation++;
	const refresher = reloadSrc;
	if (!refresher) {
		error = "Could not refresh the document";
		return;
	}
	try {
		const next = await refresher();
		error = null;
		appliedRev = 0;
		activeSrc = next;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
}

function onMessage(event: MessageEvent): void {
	const frame = iframe;
	if (!frame || event.source !== frame.contentWindow) return;
	const data = event.data as { source?: string; type?: string; rev?: number } | null;
	if (!data || typeof data !== "object" || data.source !== "artifacts") return;
	if (data.type === "ready") {
		ready = true;
		appliedRev = typeof data.rev === "number" ? data.rev : 0;
		postTheme();
	} else if (data.type === "updated") {
		const acked = typeof data.rev === "number" ? data.rev : 0;
		if (pendingRev !== null && acked >= pendingRev) {
			appliedRev = acked;
			pendingRev = null;
			clearAck();
		}
	}
}
</script>

<div class="frame">
	{#if error}
		<div class="frame-error" role="alert">
			<span>{error}</span>
			{#if reloadSrc}
				<button type="button" class="btn" onclick={() => void reload()}>
					<Icon name="refresh" size={14} /> Retry
				</button>
			{/if}
		</div>
	{/if}
	<div class="frame-body">
		{#if !ready}
			<div class="progress" aria-hidden="true"><div class="bar"></div></div>
		{/if}
		<iframe
			bind:this={iframe}
			{title}
			src={activeSrc}
			sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
			referrerpolicy="no-referrer"
		></iframe>
	</div>
</div>
<svelte:window onmessage={onMessage} />

<style>
	.frame {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--bg);
	}

	.frame-body {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: var(--bg);
	}

	.frame-error {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 14px;
		border-bottom: 1px solid var(--border);
		background: light-dark(#fff5f5, #2a1618);
		color: var(--err);
		font-size: 13px;
	}

	.frame-error span {
		flex: 1;
	}

	.progress {
		position: absolute;
		inset: 0 0 auto;
		height: 2px;
		overflow: hidden;
		background: transparent;
		z-index: 1;
	}

	.progress .bar {
		width: 30%;
		height: 100%;
		background: var(--accent);
		animation: slide 1.1s ease-in-out infinite;
	}

	@keyframes slide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(360%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.progress .bar {
			animation: none;
			width: 100%;
			opacity: 0.4;
		}
	}
</style>
