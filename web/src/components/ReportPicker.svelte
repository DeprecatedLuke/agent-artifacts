<script lang="ts">
import { tick } from "svelte";
import { listReports, type ReportSummary, reportKey } from "../lib/api";
import Icon from "./Icon.svelte";

let { current, onpick }: { current: string; onpick: (key: string) => void } = $props();

let open = $state(false);
let query = $state("");
let reports = $state<ReportSummary[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let activeIndex = $state(0);
let root = $state<HTMLDivElement | undefined>(undefined);
let input = $state<HTMLInputElement | undefined>(undefined);

const filtered = $derived.by(() => {
	const needle = query.trim().toLowerCase();
	if (!needle) return reports;
	return reports.filter(
		report =>
			report.title.toLowerCase().includes(needle) ||
			report.project.toLowerCase().includes(needle) ||
			report.slug.toLowerCase().includes(needle) ||
			`${report.project}/${report.slug}`.includes(needle),
	);
});

async function toggle(): Promise<void> {
	if (open) {
		open = false;
		return;
	}
	open = true;
	query = "";
	activeIndex = 0;
	error = null;
	loading = true;
	try {
		reports = await listReports();
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
	await tick();
	input?.focus();
}

function pick(key: string): void {
	open = false;
	onpick(key);
}

function moveTo(index: number): void {
	activeIndex = index;
	root?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
}

function onKeydown(event: KeyboardEvent): void {
	const list = filtered;
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		open = false;
	} else if (event.key === "ArrowDown") {
		event.preventDefault();
		moveTo(Math.min(activeIndex + 1, Math.max(0, list.length - 1)));
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		moveTo(Math.max(activeIndex - 1, 0));
	} else if (event.key === "Enter") {
		event.preventDefault();
		const choice = list[activeIndex];
		if (choice) pick(reportKey(choice));
	} else if (event.key === "Tab") {
		open = false;
	}
}

function onPointerDown(event: PointerEvent): void {
	if (!open || !root) return;
	const target = event.target;
	if (target instanceof Node && !root.contains(target)) open = false;
}
</script>

<svelte:window onpointerdown={onPointerDown} />

<div class="picker" bind:this={root}>
	<button
		type="button"
		class="picker-btn"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-label={current ? `Change report (current: ${current})` : "Choose a report"}
		title={current || "Choose a report"}
		onclick={() => void toggle()}
	>
		<Icon name="search" size={13} />
		<span class="label mono">{current || "Select report"}</span>
		<Icon name="chevron-down" size={13} />
	</button>

	{#if open}
		<div class="popover" role="dialog" aria-label="Choose a report">
			<input
				class="input"
				type="search"
				placeholder="Search reports…"
				aria-label="Search reports"
				bind:value={query}
				bind:this={input}
				oninput={() => (activeIndex = 0)}
				onkeydown={onKeydown}
			/>
			{#if error}
				<p class="state" role="alert">{error}</p>
			{:else if loading}
				<p class="state">Loading…</p>
			{:else if filtered.length === 0}
				<p class="state">No reports found.</p>
			{:else}
				<ul class="results" role="listbox" aria-label="Reports">
					{#each filtered as report, index (reportKey(report))}
						<li>
							<button
								type="button"
								role="option"
								aria-selected={reportKey(report) === current}
								data-index={index}
								class:active={index === activeIndex}
								onclick={() => pick(reportKey(report))}
								onpointerenter={() => (activeIndex = index)}
							>
								<span class="r-title">{report.title}</span>
								<span class="r-key mono">{reportKey(report)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
	}

	.picker-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		padding: 3px 8px;
		border-radius: 7px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted);
		font-size: 12.5px;
		cursor: pointer;
	}

	.picker-btn:hover {
		background: var(--surface);
		color: var(--fg);
	}

	.picker-btn .label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 220px;
	}

	.popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 40;
		width: min(380px, 80vw);
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 11px;
		background: var(--bg);
		box-shadow: var(--shadow);
	}

	.state {
		margin: 8px 4px;
		font-size: 13px;
		color: var(--muted);
	}

	.results {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		max-height: 280px;
		overflow: auto;
	}

	.results button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--fg);
		text-align: left;
		cursor: pointer;
	}

	.results button:hover,
	.results button.active {
		background: var(--surface);
	}

	.results button[aria-selected="true"] {
		background: var(--accent-weak);
	}

	.r-title {
		font-size: 13.5px;
		font-weight: 550;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.r-key {
		font-size: 11px;
		color: var(--muted);
	}
</style>
