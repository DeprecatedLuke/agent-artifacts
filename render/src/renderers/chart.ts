import type { Config, EmbedOptions, Result, VisualizationSpec } from "vega-embed";
import { expressionInterpreter } from "vega-interpreter";
import type { Options as TooltipOptions } from "vega-tooltip";
import { create, jsonPayload, renderError } from "./dom";
import { type ThemeTokens, themeTokens } from "./tokens";
import type { RenderContext, RendererModule, Theme } from "./types";

/**
 * `<x-chart>` embeds a Vega-Lite or Vega spec with vega-embed.
 *
 * Expressions are interpreted (ast + expr), never compiled with eval, so charts
 * work under the report CSP. Colours come from the report tokens rather than a
 * vega-theme, so light and dark follow the document theme exactly.
 */

type Embed = typeof import("vega-embed").default;

let embedFn: Promise<Embed> | null = null;

function load(): Promise<Embed> {
	// vega + vega-lite + vega-embed is the largest dependency; only fetch it for
	// reports that actually contain an <x-chart>.
	embedFn ??= import("vega-embed").then(mod => mod.default);
	return embedFn;
}

/** Live chart views, so an update or a theme switch can tear the old one down. */
const views = new WeakMap<Element, Result>();

/** Vega config that makes library defaults look like the rest of the report. */
function themeConfig(tokens: ThemeTokens): Config {
	const font = "system-ui, sans-serif";
	const grid = { gridColor: tokens.border, gridDash: [2, 3] };
	// Nominal labels read horizontally (no -90° rotation) and drop overlaps
	// rather than crowding; band axes carry no grid, so it cannot cross the
	// cells of a heatmap or the bars of a bar chart.
	const band = {
		grid: false,
		labelAngle: 0,
		labelOverlap: true,
		labelLimit: 240,
		labelColor: tokens.muted,
		labelFont: font,
		titleColor: tokens.fg,
		titleFont: font,
		domainColor: tokens.border,
		tickColor: tokens.border,
	};
	return {
		background: "transparent",
		font,
		axis: {
			labelColor: tokens.muted,
			titleColor: tokens.fg,
			domainColor: tokens.border,
			tickColor: tokens.border,
			labelFont: font,
			titleFont: font,
			labelFontSize: 11,
			titleFontSize: 12,
			titleFontWeight: 600,
			labelLimit: 160,
			labelAngle: 0,
			labelOverlap: true,
			// Grid lines belong under the marks, never on top of them.
			zindex: 0,
		},
		axisX: { grid: false, ticks: true, labelAngle: 0, labelOverlap: true, labelLimit: 240, ...grid },
		axisY: { grid: true, ticks: false, domain: false, labelAngle: 0, labelOverlap: true, ...grid },
		axisBand: band,
		legend: { labelColor: tokens.muted, titleColor: tokens.fg, labelFont: font, titleFont: font, labelLimit: 240 },
		title: { color: tokens.fg, subtitleColor: tokens.muted, font, anchor: "start" },
		// Facet row/column headers are their own config branch: without it Vega
		// falls back to black text, which is invisible on a dark background.
		header: {
			labelColor: tokens.fg,
			titleColor: tokens.fg,
			labelFont: font,
			titleFont: font,
			labelFontSize: 12,
			titleFontSize: 12,
			labelFontWeight: 600,
			labelAngle: 0,
			labelAlign: "left",
			labelAnchor: "start",
			labelOrient: "top",
		},
		style: {
			"guide-label": { fill: tokens.muted, font, fontSize: 11 },
			"guide-title": { fill: tokens.fg, font, fontSize: 12, fontWeight: 600 },
			"group-title": { fill: tokens.fg, font, fontSize: 12, fontWeight: 600 },
			"group-subtitle": { fill: tokens.muted, font, fontSize: 11 },
		},
		view: { stroke: null },
		text: { fill: tokens.fg },
		rule: { stroke: tokens.muted },
		range: {
			category: ["#4c78a8", "#f58518", "#54a24b", "#e45756", "#72b7b2", "#eeca3b", "#b279a2", "#ff9da6"],
		},
	};
}

/**
 * Multi-view specs (facet, concat, repeat) size their cells, not their frame,
 * and Vega-Lite ignores `width: "container"` there. Cells start at a known
 * number so {@link fitToContainer} can measure the frame's non-plot width and
 * grow them to the column; a `{step: n}` width is a deliberate band size.
 */
const CELL_START = 400;

function responsive(spec: unknown): VisualizationSpec {
	if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
		throw new Error("the payload must be a JSON object");
	}
	const record = spec as Record<string, unknown>;
	const lite = ["mark", "encoding", "layer", "facet", "hconcat", "vconcat", "repeat", "spec"].some(
		key => key in record,
	);
	if (!lite) return record as VisualizationSpec;
	const single =
		("mark" in record || "layer" in record) &&
		!["facet", "hconcat", "vconcat", "repeat", "spec"].some(key => key in record);
	if (single) {
		if (!("width" in record)) record.width = "container";
		if (!("autosize" in record)) record.autosize = { type: "fit-x", contains: "padding" };
		return record as VisualizationSpec;
	}
	if (!("autosize" in record)) record.autosize = { type: "pad", contains: "padding" };
	const cell = cellOf(record);
	if (cell !== undefined && needsFit(record)) cell.width = CELL_START;
	return record as VisualizationSpec;
}

/** The spec object that carries a multi-view chart's cell width. */
function cellOf(record: Record<string, unknown>): Record<string, unknown> | undefined {
	const nested = record.spec;
	if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
	for (const key of ["vconcat", "hconcat"]) {
		const views = record[key];
		if (Array.isArray(views) && views.length > 0) {
			const first = views[0];
			if (first && typeof first === "object" && !Array.isArray(first)) return first as Record<string, unknown>;
		}
	}
	return undefined;
}

/** Whether a spec sizes its cells independently of the frame, i.e. needs measuring. */
function needsFit(record: Record<string, unknown>): boolean {
	const cell = cellOf(record);
	if (cell === undefined) return false;
	// A `{step: n}` width is a deliberate band size, not a cell width to stretch.
	return typeof cell.width !== "object";
}

function cleanup(host: Element): void {
	const previous = views.get(host);
	if (previous) {
		views.delete(host);
		try {
			previous.finalize();
		} catch {
			/* already finalized */
		}
	}
	for (const node of [...host.querySelectorAll(":scope > .x-chart-canvas, :scope > .x-error")]) node.remove();
}

async function renderChart(embed: Embed, host: HTMLElement, theme: Theme): Promise<void> {
	cleanup(host);
	const canvas = create("div", "x-chart-canvas");
	host.append(canvas);

	let spec: VisualizationSpec;
	try {
		spec = responsive(jsonPayload(host));
	} catch (err) {
		canvas.remove();
		renderError(host, err);
		return;
	}

	const tooltip: TooltipOptions = {
		disableDefaultStyle: true,
		anchor: "cursor",
		offsetX: 12,
		offsetY: 12,
	};
	const options: EmbedOptions = {
		// ast + a vega-interpreter expr: signals and selections are interpreted,
		// never compiled with eval/new Function, so this works under the CSP.
		ast: true,
		expr: expressionInterpreter,
		actions: false,
		tooltip,
		renderer: "svg",
		hover: true,
		config: themeConfig(themeTokens(theme)),
	};
	try {
		let result = await embed(canvas, spec, options);
		result = await fitToContainer(embed, canvas, spec, options, result);
		views.set(host, result);
	} catch (err) {
		canvas.remove();
		renderError(host, err);
	}
}

/**
 * Give a multi-view chart the width of its container. Vega-Lite cannot resolve
 * `width: "container"` inside a facet, and agents pick arbitrary cell numbers,
 * so the chart starts from a known cell width, the frame's non-plot width
 * (facet headers, axes, legends, padding) is measured as `frame − cell`, and the
 * cell is set to `container − that`. Repeats until the frame fits, because the
 * overhead shifts slightly once the cells resize. A `{step: n}` width is left
 * alone.
 */
async function fitToContainer(
	embed: Embed,
	canvas: HTMLElement,
	spec: VisualizationSpec,
	options: EmbedOptions,
	first: Result,
): Promise<Result> {
	const record = spec as Record<string, unknown>;
	const cell = cellOf(record);
	if (cell === undefined || !needsFit(record)) return first;
	const container = canvas.clientWidth;
	if (container <= 0) return first;
	let width = typeof cell.width === "number" ? cell.width : CELL_START;
	let result = first;
	for (let pass = 0; pass < 3; pass++) {
		const frame = canvas.querySelector("svg")?.getBoundingClientRect().width ?? 0;
		if (frame <= 0) return result;
		const want = Math.max(160, Math.floor(container - (frame - width)));
		if (Math.abs(want - width) <= 2) return result;
		result.finalize();
		cell.width = want;
		width = want;
		result = await embed(canvas, spec, options);
	}
	return result;
}

export async function render(root: ParentNode, ctx: RenderContext): Promise<void> {
	const hosts = [...root.querySelectorAll<HTMLElement>("x-chart")];
	if (!hosts.length) return;
	const embed = await load();
	await Promise.all(hosts.map(host => renderChart(embed, host, ctx.theme)));
}

export function reset(root: ParentNode): void {
	for (const host of [...root.querySelectorAll<HTMLElement>("x-chart")]) cleanup(host);
}

/** The palette is baked into the embedded spec, so a theme switch re-embeds. */
export async function theme(root: ParentNode, ctx: RenderContext): Promise<void> {
	await render(root, ctx);
}

const module_: RendererModule = { render, reset, theme };
export default module_;
