<script lang="ts">
import { router, splitUrl } from "../lib/router.svelte";
import Icon from "./Icon.svelte";
import SplitPane from "./SplitPane.svelte";

let { panes }: { panes: string[] } = $props();

let grid = $state<HTMLDivElement | undefined>(undefined);
let sizes = $state<number[]>([]);
let dragging = $state(false);

const count = $derived(panes.length);
const columns = $derived(
	(sizes.length === count ? sizes : Array.from({ length: count }, () => 1 / count))
		.map(size => `minmax(0, ${size}fr)`)
		.join(" 7px "),
);

$effect(() => {
	const n = count;
	if (sizes.length !== n) sizes = Array.from({ length: n }, () => 1 / n);
});

function commit(next: string[]): void {
	router.navigate(splitUrl(next), { replace: true });
}

function setPane(index: number, key: string): void {
	commit(panes.map((pane, i) => (i === index ? key : pane)));
}

function closePane(index: number): void {
	const next = panes.filter((_, i) => i !== index);
	commit(next.length > 0 ? next : [""]);
}

function addPane(): void {
	if (count >= 4) return;
	commit([...panes, ""]);
}

function startDrag(index: number, event: PointerEvent): void {
	if (event.button !== 0 || !grid) return;
	const handle = event.currentTarget as HTMLElement;
	handle.setPointerCapture(event.pointerId);
	dragging = true;
	const bounds = grid.getBoundingClientRect();
	const available = Math.max(1, bounds.width - (count - 1) * 7);
	const startX = event.clientX;
	const start = [...sizes];
	const minimum = Math.min(0.45, Math.max(0.08, 140 / available));

	const move = (moveEvent: PointerEvent): void => {
		const pair = start[index] + start[index + 1];
		const low = Math.min(minimum, pair / 2);
		const left = Math.min(Math.max(start[index] + (moveEvent.clientX - startX) / available, low), pair - low);
		const next = [...start];
		next[index] = left;
		next[index + 1] = pair - left;
		sizes = next;
	};

	const finish = (finishEvent: PointerEvent): void => {
		handle.releasePointerCapture(finishEvent.pointerId);
		handle.removeEventListener("pointermove", move);
		handle.removeEventListener("pointerup", finish);
		handle.removeEventListener("pointercancel", finish);
		dragging = false;
	};

	handle.addEventListener("pointermove", move);
	handle.addEventListener("pointerup", finish);
	handle.addEventListener("pointercancel", finish);
}

function onDividerKey(index: number, event: KeyboardEvent): void {
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	const step = (event.shiftKey ? 0.08 : 0.02) * (event.key === "ArrowRight" ? 1 : -1);
	const pair = sizes[index] + sizes[index + 1];
	const low = 0.08;
	const left = Math.min(Math.max(sizes[index] + step, low), pair - low);
	const next = [...sizes];
	next[index] = left;
	next[index + 1] = pair - left;
	sizes = next;
}
</script>

<div class="split-page">
	<div class="toolbar">
		<span class="count">{count} of 4 panes</span>
		<span class="hint">Drag the dividers to resize</span>
		<span class="grow"></span>
		<button type="button" class="btn" onclick={addPane} disabled={count >= 4}>
			<Icon name="plus" size={14} /> Add pane
		</button>
	</div>

	<div
		class="split"
		class:dragging
		bind:this={grid}
		style:grid-template-columns={columns}
		aria-label="Split report view"
	>
		{#each panes as pane, index (index)}
			<SplitPane
				paneKey={pane}
				onpick={key => setPane(index, key)}
				onclose={() => closePane(index)}
			/>
			{#if index < count - 1}
				<button
					type="button"
					class="divider"
					aria-label={`Resize pane ${index + 1} and ${index + 2}`}
					onpointerdown={event => startDrag(index, event)}
					onkeydown={event => onDividerKey(index, event)}
				></button>
			{/if}
		{/each}
	</div>
</div>

<style>
	.split-page {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		padding: 10px 12px 12px;
		gap: 10px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
	}

	.count {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--muted);
	}

	.hint {
		font-size: 12px;
		color: var(--muted);
		opacity: 0.8;
	}

	.grow {
		flex: 1;
	}

	.split {
		flex: 1;
		min-height: 0;
		display: grid;
	}

	.split.dragging {
		user-select: none;
		cursor: col-resize;
	}

	.split.dragging :global(iframe) {
		pointer-events: none;
	}

	.divider {
		position: relative;
		height: 100%;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		touch-action: none;
		cursor: col-resize;
	}

	.divider::after {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		left: 2px;
		right: 2px;
		border-radius: 2px;
		background: var(--border);
		transition: background 0.12s ease;
	}

	.divider:hover::after,
	.divider:focus-visible::after,
	.split.dragging .divider::after {
		background: var(--accent);
	}

	.divider:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
</style>
