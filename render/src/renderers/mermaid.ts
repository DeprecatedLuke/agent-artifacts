import { themeTokens } from "./tokens";
import type { RenderContext, RendererModule, Theme } from "./types";

/** Mermaid's own API surface that we use. */
interface MermaidApi {
	initialize(config: Record<string, unknown>): void;
	render(id: string, text: string): Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
}

let api: Promise<MermaidApi> | null = null;
let sequence = 0;
/** mermaid.render is not safe to run concurrently; keep renders in one chain. */
let chain: Promise<void> = Promise.resolve();

function load(): Promise<MermaidApi> {
	api ??= import("mermaid").then(mod => mod.default);
	return api;
}

/**
 * Mermaid takes literal colours, so build its palette from the report tokens:
 * node fills, borders, text and edges then match the surrounding document in
 * both themes instead of mermaid's default purple.
 */
function configure(mermaid: MermaidApi, theme: Theme): void {
	const tokens = themeTokens(theme);
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: "base",
		fontFamily: "system-ui, sans-serif",
		themeVariables: {
			fontFamily: "system-ui, sans-serif",
			fontSize: "14px",
			background: tokens.bg,
			mainBkg: tokens.surface,
			primaryColor: tokens.surface,
			primaryTextColor: tokens.fg,
			primaryBorderColor: tokens.border,
			secondaryColor: tokens.surface,
			secondaryTextColor: tokens.fg,
			secondaryBorderColor: tokens.border,
			tertiaryColor: tokens.bg,
			tertiaryTextColor: tokens.muted,
			tertiaryBorderColor: tokens.border,
			nodeBorder: tokens.border,
			nodeTextColor: tokens.fg,
			clusterBkg: tokens.surface,
			clusterBorder: tokens.border,
			titleColor: tokens.fg,
			textColor: tokens.fg,
			lineColor: tokens.muted,
			edgeLabelBackground: tokens.bg,
			labelTextColor: tokens.fg,
			actorBkg: tokens.surface,
			actorBorder: tokens.border,
			actorTextColor: tokens.fg,
			actorLineColor: tokens.muted,
			signalColor: tokens.muted,
			signalTextColor: tokens.fg,
			labelBoxBkgColor: tokens.surface,
			labelBoxBorderColor: tokens.border,
			labelTextColor2: tokens.fg,
			noteBkgColor: tokens.surface,
			noteBorderColor: tokens.border,
			noteTextColor: tokens.fg,
			activationBkgColor: tokens.surface,
			activationBorderColor: tokens.border,
			sectionBkgColor: tokens.surface,
			sectionBkgColor2: tokens.bg,
			taskBkgColor: tokens.surface,
			taskBorderColor: tokens.border,
			taskTextColor: tokens.fg,
			taskTextDarkColor: tokens.fg,
			todayLineColor: tokens.accent,
			gridColor: tokens.border,
			pie1: tokens.accent,
			pie2: tokens.ok,
			pie3: tokens.warn,
			pie4: tokens.err,
			pie5: tokens.muted,
			pieTitleTextColor: tokens.fg,
			pieSectionTextColor: tokens.fg,
			pieLegendTextColor: tokens.fg,
			pieStrokeColor: tokens.bg,
			pieOuterStrokeColor: tokens.border,
			classText: tokens.fg,
			stateBkg: tokens.surface,
			stateBorder: tokens.border,
			compositeBackground: tokens.surface,
			compositeTitleBackground: tokens.surface,
			compositeBorder: tokens.border,
		},
		flowchart: { htmlLabels: true, useMaxWidth: true, curve: "basis", padding: 12 },
		sequence: { useMaxWidth: true, mirrorActors: false },
		gantt: { useMaxWidth: true },
		class: { useMaxWidth: true },
		state: { useMaxWidth: true },
		er: { useMaxWidth: true },
		pie: { useMaxWidth: true },
	});
}

async function renderOne(mermaid: MermaidApi, pre: HTMLPreElement): Promise<void> {
	const source = pre.textContent ?? "";
	const stale = pre.nextElementSibling;
	if (stale?.matches(".mermaid-figure, .x-error")) stale.remove();
	if (!source.trim()) return;
	const id = `agent-reports-mermaid-${++sequence}`;
	try {
		const { svg, bindFunctions } = await mermaid.render(id, source);
		const figure = document.createElement("div");
		figure.className = "mermaid-figure";
		figure.innerHTML = svg;
		const svgEl = figure.querySelector("svg");
		if (svgEl) {
			svgEl.removeAttribute("height");
			// Mermaid caps the width itself; overriding that would stretch small
			// diagrams to the full measure.
			svgEl.style.height = "auto";
		}
		pre.after(figure);
		pre.hidden = true;
		bindFunctions?.(figure);
	} catch (err) {
		document.getElementById(id)?.remove();
		document.getElementById(`d${id}`)?.remove();
		const message = err instanceof Error ? err.message : String(err);
		const box = document.createElement("div");
		box.className = "x-error";
		box.setAttribute("role", "alert");
		box.textContent = message;
		pre.after(box);
		pre.hidden = true;
	}
}

export async function render(root: ParentNode, ctx: RenderContext): Promise<void> {
	const pres = [...root.querySelectorAll<HTMLPreElement>("pre.mermaid")];
	if (!pres.length) return;
	const mermaid = await load();
	configure(mermaid, ctx.theme);
	for (const pre of pres) {
		chain = chain.then(() => renderOne(mermaid, pre));
	}
	await chain;
}

export function reset(root: ParentNode): void {
	for (const figure of [...root.querySelectorAll(".mermaid-figure")]) figure.remove();
	for (const pre of [...root.querySelectorAll<HTMLPreElement>("pre.mermaid")]) pre.hidden = false;
	for (const box of [...root.querySelectorAll("pre.mermaid + .x-error")]) box.remove();
}

/** Diagram colours are baked into the SVG, so a theme switch re-renders. */
export async function theme(root: ParentNode, ctx: RenderContext): Promise<void> {
	for (const figure of [...root.querySelectorAll(".mermaid-figure")]) figure.remove();
	for (const pre of [...root.querySelectorAll<HTMLPreElement>("pre.mermaid")]) pre.hidden = false;
	await render(root, ctx);
}

const module_: RendererModule = { render, reset, theme };
export default module_;
