<script lang="ts">
import { createShare, listShares, revokeShare, type Share } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { exactTime, expiresIn, isExpired, startClock } from "../lib/time";
import { appSocket } from "../lib/ws.svelte";
import Icon from "./Icon.svelte";

let { open = $bindable(false), project, slug }: { open?: boolean; project: string; slug: string } = $props();

let dialog = $state<HTMLDialogElement | undefined>(undefined);
let shares = $state<Share[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let creating = $state(false);
let copiedToken = $state<string | null>(null);
let confirmingToken = $state<string | null>(null);
let now = $state(Date.now());
let confirmTimer: number | undefined;

const active = $derived(shares.filter(share => !isExpired(share.expires_at, now)));

async function load(): Promise<void> {
	loading = true;
	try {
		shares = await listShares(project, slug);
		error = null;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

$effect(() => {
	const element = dialog;
	if (!element) return;
	if (open) {
		if (!element.open) element.showModal();
		void load();
	} else if (element.open) {
		element.close();
	}
});

$effect(() => {
	if (!open) return;
	const unsubscribe = appSocket.subscribe(event => {
		if (event.type === "resync") void load();
		else if (event.type === "share.changed" && event.project === project && event.slug === slug) void load();
	});
	appSocket.connect();
	const stopClock = startClock(15_000, tick => {
		now = tick;
	});
	return () => {
		unsubscribe();
		stopClock();
	};
});

async function create(): Promise<void> {
	creating = true;
	error = null;
	try {
		const share = await createShare(project, slug);
		shares = [share, ...shares];
		copiedToken = (await copyText(share.url)) ? share.token : null;
		if (!copiedToken) error = "Link created, but copying it to the clipboard failed.";
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		creating = false;
	}
}

async function copy(share: Share): Promise<void> {
	const ok = await copyText(share.url);
	copiedToken = ok ? share.token : null;
	if (!ok) error = "Could not copy the link.";
}

async function revoke(share: Share): Promise<void> {
	if (confirmingToken !== share.token) {
		confirmingToken = share.token;
		if (confirmTimer !== undefined) window.clearTimeout(confirmTimer);
		confirmTimer = window.setTimeout(() => {
			confirmingToken = null;
		}, 4000);
		return;
	}
	try {
		await revokeShare(share.token);
		shares = shares.filter(candidate => candidate.token !== share.token);
		confirmingToken = null;
		error = null;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
}

function onBackdrop(event: MouseEvent): void {
	if (event.target === dialog) open = false;
}
</script>

<dialog
	bind:this={dialog}
	class="share-dialog"
	aria-labelledby="share-dialog-title"
	onclose={() => (open = false)}
	onclick={onBackdrop}
>
	<div class="inner">
		<div class="head">
			<h2 id="share-dialog-title">Share link</h2>
			<button type="button" class="icon-btn" aria-label="Close share dialog" onclick={() => (open = false)}>
				<Icon name="close" />
			</button>
		</div>
		<p class="hint">
			Anyone with the link can read <span class="mono">{project}/{slug}</span> until it expires — 7 days after creation.
		</p>

		<div class="create-row">
			<button type="button" class="btn primary" onclick={create} disabled={creating}>
				<Icon name="link" size={14} /> {creating ? "Creating…" : "Create link"}
			</button>
		</div>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		{#if loading && active.length === 0}
			<p class="hint">Loading…</p>
		{:else if active.length === 0}
			<p class="hint">No active links.</p>
		{:else}
			<ul class="shares">
				{#each active as share (share.token)}
					<li>
						<div class="share-text">
							<div class="url mono" title={share.url}>{share.url}</div>
							<div class="expiry">
								<time datetime={share.expires_at} title={exactTime(share.expires_at)}>
									{expiresIn(share.expires_at, now)}
								</time>
							</div>
						</div>
						<button type="button" class="btn" onclick={() => copy(share)} aria-label={`Copy link ${share.url}`}>
							<Icon name={copiedToken === share.token ? "check" : "copy"} size={14} />
							{copiedToken === share.token ? "Copied" : "Copy"}
						</button>
						<button
							type="button"
							class="btn danger"
							onclick={() => revoke(share)}
							aria-label={`Revoke link ${share.url}`}
						>
							<Icon name="trash" size={14} />
							{confirmingToken === share.token ? "Confirm" : "Revoke"}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</dialog>

<style>
	.share-dialog {
		width: min(660px, calc(100vw - 32px));
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg);
		color: var(--fg);
		box-shadow: var(--shadow);
	}

	.share-dialog::backdrop {
		background: light-dark(rgb(15 20 30 / 35%), rgb(0 0 0 / 62%));
		backdrop-filter: blur(2px);
	}

	.inner {
		padding: 16px 18px 18px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.head h2 {
		flex: 1;
		font-size: 16.5px;
	}

	.hint {
		margin: 6px 0 12px;
		color: var(--muted);
		font-size: 13px;
	}

	.create-row {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}

	.error {
		margin: 0 0 12px;
		color: var(--err);
		font-size: 13px;
	}

	.shares {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.shares li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface);
	}

	.share-text {
		flex: 1;
		min-width: 0;
	}

	.url {
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.expiry {
		font-size: 11.5px;
		color: var(--muted);
	}
</style>
