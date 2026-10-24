/**
 * Table layout, owned by the runtime.
 *
 * A report is written by an agent that cannot be asked to size a table, so the
 * renderer decides for it: every table gets a wrapper that owns the box drawing
 * and the expand button, and a scroll box that is the only element allowed to
 * clip. Widening (a table with many columns, or content that does not fit the
 * text column) and scrolling (content that still does not fit at the wide max)
 * are measured at runtime and kept correct by a ResizeObserver, because the
 * iframe also changes width in the split view.
 *
 * `overflow: clip` while the table fits is what makes the sticky `thead th`
 * work: a scroll container would become the sticky scrollport, and the header
 * would stick to the table instead of to the top of the iframe viewport.
 */

import { el, reportBody } from "./dom";
import { openTable } from "./viewer";

const WRAP = "report-table";
const SCROLL = "report-table-scroll";
/** Markup whose renderer owns its own layout; wrapping it would fight the library. */
const OPAQUE = "x-diff, x-chart, .report-viewer";
/** A table with at least this many columns is given the wide measure. */
const WIDE_COLUMNS = 4;

let observer: ResizeObserver | null = null;
let frame = 0;

function tableOf(wrap: HTMLElement): HTMLTableElement | null {
	const table = wrap.querySelector("table");
	return table instanceof HTMLTableElement ? table : null;
}

/**
 * Tables drawn by a renderer (diff, chart) or nested inside another table stay
 * as authored: they are not part of the report's own layout problem. A table
 * already in a runtime wrapper is skipped, so enhancing twice is a no-op.
 */
function eligible(table: HTMLTableElement): boolean {
	if (table.closest(OPAQUE) || table.closest(`.${WRAP}`)) return false;
	return !table.parentElement?.closest("table");
}

function schedule(): void {
	if (frame) return;
	frame = requestAnimationFrame(() => {
		frame = 0;
		layout();
	});
}

function observe(body: HTMLElement): void {
	observer?.disconnect();
	observer = new ResizeObserver(() => schedule());
	observer.observe(body);
	for (const wrap of body.querySelectorAll<HTMLElement>(`.${WRAP}`)) {
		observer.observe(wrap);
		const table = tableOf(wrap);
		if (table) observer.observe(table);
	}
}

/** Column count of the header row, colspans included. */
function columnsOf(table: HTMLTableElement | null): number {
	const row = table?.rows[0];
	if (!row) return 0;
	let count = 0;
	for (const cell of row.cells) count += cell.colSpan || 1;
	return count;
}

/**
 * Two batched read passes. First the width the table wants at the narrow
 * measure: the wrapper is a block, so its own box stays the text column while an
 * unfittable table overflows it. Then the width it gets once widened, which is
 * the only case that may still need a scrollbar.
 */
function layout(): void {
	const body = reportBody();
	if (!body) return;
	const wraps = [...body.querySelectorAll<HTMLElement>(`.${WRAP}`)];
	if (!wraps.length) return;

	for (const wrap of wraps) wrap.classList.remove("is-wide", "is-scroll");

	const measured = wraps.map(wrap => {
		const table = tableOf(wrap);
		return {
			wrap,
			narrow: wrap.getBoundingClientRect().width,
			wanted: table?.getBoundingClientRect().width ?? 0,
			columns: columnsOf(table),
		};
	});
	const wide = measured.filter(box => box.columns >= WIDE_COLUMNS || box.wanted > box.narrow + 0.5);
	for (const box of wide) box.wrap.classList.add("is-wide");

	const widened = wide.map(box => ({
		wrap: box.wrap,
		needed: tableOf(box.wrap)?.getBoundingClientRect().width ?? null,
		available: box.wrap.getBoundingClientRect().width,
	}));
	for (const box of widened) {
		if (box.needed !== null && box.needed > box.available + 0.5) box.wrap.classList.add("is-scroll");
	}
}

export function enhanceTables(body: HTMLElement): void {
	let added = false;
	for (const table of [...body.querySelectorAll("table")]) {
		if (!eligible(table)) continue;
		const scroll = el("div", SCROLL);
		const wrap = el("div", WRAP);
		const button = el("button", "report-table-expand");
		button.type = "button";
		button.setAttribute("aria-label", "Expand table");
		button.addEventListener("click", () => openTable(table, button));
		// `replaceWith` keeps the table's position in the authored flow; the table
		// then moves into the scroll box, and the box into the wrapper.
		table.replaceWith(wrap);
		scroll.append(table);
		wrap.append(scroll, button);
		added = true;
	}
	if (!added) return;
	observe(body);
	layout();
}

/** Puts the authored tables back, so a live update morphs raw markup onto raw markup. */
export function unenhanceTables(body: HTMLElement): void {
	observer?.disconnect();
	observer = null;
	if (frame) {
		cancelAnimationFrame(frame);
		frame = 0;
	}
	for (const wrap of [...body.querySelectorAll<HTMLElement>(`.${WRAP}`)]) {
		const table = tableOf(wrap);
		if (table) wrap.replaceWith(table);
		else wrap.remove();
	}
}
