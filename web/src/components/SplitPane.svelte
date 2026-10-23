<script lang="ts">
import { ApiError, getReport } from "../lib/api";
import { appSocket } from "../lib/ws.svelte";
import Icon from "./Icon.svelte";
import ReportPicker from "./ReportPicker.svelte";
import ReportSurface from "./ReportSurface.svelte";

let { paneKey, onpick, onclose }: { paneKey: string; onpick: (key: string) => void; onclose: () => void } = $props();

const parts = $derived(paneKey.split("/"));
const project = $derived(parts[0] ?? "");
const slug = $derived(parts[1] ?? "");
const valid = $derived(/^[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}$/.test(paneKey));

let rev = $state(0);
let deleted = $state(false);
let error = $state<string | null>(null);

async function load(key: string): Promise<void> {
	if (!key) {
		rev = 0;
		deleted = false;
		error = null;
		return;
	}
	const [nextProject, nextSlug] = key.split("/");
	try {
		const report = await getReport(nextProject, nextSlug);
		if (key !== paneKey) return;
		rev = report.rev;
		deleted = false;
		error = null;
	} catch (err) {
		if (key !== paneKey) return;
		if (err instanceof ApiError && err.status === 404) {
			deleted = true;
		} else {
			error = err instanceof Error ? err.message : String(err);
		}
	}
}

$effect(() => {
	const key = paneKey;
	void load(key);
	if (!key) return;
	const unsubscribe = appSocket.subscribe(event => {
		if (event.type === "report.upserted" && event.report) {
			if (`${event.report.project}/${event.report.slug}` !== key) return;
			rev = event.report.rev;
			deleted = false;
		} else if (event.type === "report.deleted") {
			if (`${event.project}/${event.slug}` === key) deleted = true;
		} else if (event.type === "resync") {
			void load(key);
		}
	});
	const unsubscribeReconnect = appSocket.onReconnect(() => void load(key));
	appSocket.connect();
	return () => {
		unsubscribe();
		unsubscribeReconnect();
	};
});
</script>

<section class="pane" aria-label={paneKey ? `Pane ${paneKey}` : "Empty pane"}>
	<header class="pane-head">
		<ReportPicker current={paneKey} {onpick} />
		<span class="grow"></span>
		{#if valid}
			<a
				class="icon-btn"
				href={`/r/${project}/${slug}`}
				aria-label={`Open ${paneKey} full page`}
				title="Open full page"
			>
				<Icon name="external" size={14} />
			</a>
		{/if}
		<button type="button" class="icon-btn" onclick={onclose} aria-label="Close pane" title="Close pane">
			<Icon name="close" size={14} />
		</button>
	</header>

	<div class="pane-body">
		{#if !paneKey}
			<div class="pane-empty">
				<Icon name="split" size={26} />
				<p>Choose a report for this pane.</p>
			</div>
		{:else if deleted}
			<div class="pane-empty">
				<p>This report was deleted.</p>
				<a class="btn" href="/">All reports</a>
			</div>
		{:else if error}
			<div class="pane-empty">
				<p role="alert">{error}</p>
			</div>
		{:else if valid}
			{#key paneKey}
				<ReportSurface {project} {slug} {rev} />
			{/key}
		{:else}
			<div class="pane-empty">
				<p>Unknown report key <span class="mono">{paneKey}</span>.</p>
			</div>
		{/if}
	</div>
</section>

<style>
	.pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		height: 100%;
		border: 1px solid var(--border);
		border-radius: 9px;
		overflow: hidden;
		background: var(--bg);
	}

	.pane-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		flex: none;
		min-height: 37px;
	}

	.grow {
		flex: 1;
	}

	.pane-body {
		flex: 1;
		min-height: 0;
	}

	.pane-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 100%;
		padding: 24px;
		color: var(--muted);
		font-size: 13.5px;
		text-align: center;
	}

	.pane-empty p {
		margin: 0;
	}
</style>
