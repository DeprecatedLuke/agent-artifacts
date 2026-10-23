import type Tablesort from "tablesort";
import { create } from "./dom";
import type { RenderContext, RendererModule } from "./types";

let uid = 0;

function sectionsOf(tabs: Element): HTMLElement[] {
	return [...tabs.children].filter((child): child is HTMLElement => child.tagName === "SECTION");
}

function syncTabs(tabs: HTMLElement): void {
	const sections = sectionsOf(tabs);
	if (!sections.length) return;
	let bar = tabs.querySelector<HTMLElement>(":scope > .x-tabbar");
	if (!bar) {
		bar = create("div", "x-tabbar");
		bar.setAttribute("role", "tablist");
		tabs.prepend(bar);
	}

	let active = sections.findIndex(section => !section.hidden);
	if (active < 0 || active >= sections.length) active = 0;

	bar.replaceChildren(
		...sections.map((section, index) => {
			const button = create("button", undefined, section.getAttribute("title") || `Tab ${index + 1}`);
			button.type = "button";
			button.id = `x-tab-${++uid}`;
			button.setAttribute("role", "tab");
			button.setAttribute("aria-selected", String(index === active));
			button.tabIndex = index === active ? 0 : -1;
			button.dataset.xTab = String(index);
			return button;
		}),
	);

	sections.forEach((section, index) => {
		section.hidden = index !== active;
		section.setAttribute("role", "tabpanel");
	});
}

function syncMetric(metric: HTMLElement): void {
	const label = metric.getAttribute("label") ?? "";
	const value = metric.getAttribute("value") ?? "";
	const delta = metric.getAttribute("delta");
	const trend = metric.getAttribute("trend") ?? "neutral";
	let inner = metric.querySelector<HTMLElement>(":scope > .x-metric-inner");
	if (!inner) {
		inner = create("div", "x-metric-inner");
		metric.append(inner);
	}
	const parts: Node[] = [];
	if (label) parts.push(create("span", "x-metric-label", label));
	parts.push(create("span", "x-metric-value", value));
	if (delta) parts.push(create("span", `x-metric-delta is-${trend}`, delta));
	inner.replaceChildren(...parts);
}

/* ------------------------------------------------------------------ tables -- */

type Sorter = (table: HTMLTableElement) => Tablesort;

let sorterPromise: Promise<Sorter> | null = null;

/**
 * `tablesort` (tristen/tablesort) with its number and filesize extensions makes
 * `table.sortable` headers click-to-sort. It writes `aria-sort` on the clicked
 * header, which is what report.css draws the indicator from.
 */
function getSorter(): Promise<Sorter> {
	sorterPromise ??= (async () => {
		// Lazy on purpose: only reports with a sortable table fetch the library
		// (see renderers/index.ts: every renderer loads its library on demand).
		const { default: Tablesort } = await import("tablesort");
		// The bundled extensions are plain scripts that register themselves on
		// `window.Tablesort`, so the global has to exist before they run.
		// Public surface of the package, used as the bridge the extensions expect.
		(window as unknown as { Tablesort: typeof Tablesort }).Tablesort = Tablesort;
		await Promise.all([
			import("tablesort/src/sorts/tablesort.number.js"),
			import("tablesort/src/sorts/tablesort.filesize.js"),
		]);
		// ISO 8601 first: the package's own date extension parses `2026-10-23`
		// as 2023-10-26, so dates are matched and compared here instead.
		Tablesort.extend(
			"date",
			item => /^\d{4}-\d{2}-\d{2}/.test(item) && !Number.isNaN(Date.parse(item)),
			(a, b) => Date.parse(b) - Date.parse(a),
		);
		return (table: HTMLTableElement) => new Tablesort(table, { descending: false });
	})();
	return sorterPromise;
}

/** Tables already wired, so an update never double-binds the header clicks. */
const sorters = new WeakMap<HTMLTableElement, Tablesort>();

async function sortTables(root: ParentNode): Promise<void> {
	const tables = [...root.querySelectorAll<HTMLTableElement>("table.sortable")].filter(table => table.tHead);
	if (!tables.length) return;
	const sorter = await getSorter();
	for (const table of tables) {
		if (sorters.has(table)) continue;
		sorters.set(table, sorter(table));
	}
}

export async function render(root: ParentNode, _ctx: RenderContext): Promise<void> {
	for (const tabs of root.querySelectorAll<HTMLElement>("x-tabs")) syncTabs(tabs);
	for (const metric of root.querySelectorAll<HTMLElement>("x-metric")) syncMetric(metric);
	await sortTables(root);
}

export function reset(root: ParentNode): void {
	for (const tabs of root.querySelectorAll<HTMLElement>("x-tabs")) {
		tabs.querySelector(":scope > .x-tabbar")?.remove();
		for (const section of sectionsOf(tabs)) {
			section.hidden = false;
			section.removeAttribute("role");
		}
	}
	for (const metric of root.querySelectorAll<HTMLElement>("x-metric")) {
		metric.querySelector(":scope > .x-metric-inner")?.remove();
	}
}

const module_: RendererModule = { render, reset };
export default module_;
