import { compareImages, create } from "./dom";
import type { RenderContext, RendererModule } from "./types";

type Mode = "slider" | "side" | "overlay";

let sliderReady: Promise<void> | null = null;

function loadSlider(): Promise<void> {
	// The web component (and its shadow styles) only loads for slider-mode compares.
	sliderReady ??= import("img-comparison-slider").then(() => undefined);
	return sliderReady;
}

function labels(host: Element): [string, string] {
	const raw = host.getAttribute("labels") ?? "Before|After";
	const [before, after] = raw.split("|");
	return [before?.trim() || "Before", after?.trim() || "After"];
}

function badge(text: string, kind: "is-before" | "is-after"): HTMLSpanElement {
	const span = create("span", `x-compare-label ${kind}`, text);
	return span;
}

function buildSlider(before: HTMLImageElement, after: HTMLImageElement, [beforeLabel, afterLabel]: [string, string]) {
	const view = create("div", "x-compare-view");
	const slider = document.createElement("img-comparison-slider");
	slider.setAttribute("tabindex", "0");
	slider.setAttribute("aria-label", "Image comparison");
	const first = before.cloneNode(true) as HTMLImageElement;
	const second = after.cloneNode(true) as HTMLImageElement;
	first.slot = "first";
	second.slot = "second";
	first.removeAttribute("hidden");
	second.removeAttribute("hidden");
	slider.append(first, second);
	view.append(slider, badge(beforeLabel, "is-before"), badge(afterLabel, "is-after"));
	return view;
}

function buildSide(before: HTMLImageElement, after: HTMLImageElement, [beforeLabel, afterLabel]: [string, string]) {
	const view = create("div", "x-compare-view x-compare-side");
	for (const [img, label, kind] of [
		[before, beforeLabel, "is-before"],
		[after, afterLabel, "is-after"],
	] as const) {
		const figure = create("figure");
		const clone = img.cloneNode(true) as HTMLImageElement;
		clone.removeAttribute("hidden");
		figure.append(clone, badge(label, kind));
		view.append(figure);
	}
	return view;
}

function buildOverlay(before: HTMLImageElement, after: HTMLImageElement, [beforeLabel, afterLabel]: [string, string]) {
	const view = create("div", "x-compare-view x-compare-overlay");
	const bottom = after.cloneNode(true) as HTMLImageElement;
	bottom.removeAttribute("hidden");
	const top = create("div", "x-compare-top");
	const topImg = before.cloneNode(true) as HTMLImageElement;
	topImg.removeAttribute("hidden");
	top.append(topImg);
	const handle = create("div", "x-compare-handle");
	const range = create("input");
	range.type = "range";
	range.min = "0";
	range.max = "100";
	range.value = "50";
	range.setAttribute("aria-label", "Comparison position");
	range.addEventListener("input", () => {
		view.style.setProperty("--x-compare-pos", `${range.value}%`);
	});
	view.append(bottom, top, handle, range, badge(beforeLabel, "is-before"), badge(afterLabel, "is-after"));
	return view;
}

function renderOne(host: HTMLElement, mode: Mode): void {
	host.querySelector(":scope > .x-compare-view")?.remove();
	const images = compareImages(host);
	if (!images) return;
	const [before, after] = images;
	before.hidden = true;
	after.hidden = true;
	const [beforeLabel, afterLabel] = labels(host);
	const view =
		mode === "side"
			? buildSide(before, after, [beforeLabel, afterLabel])
			: mode === "overlay"
				? buildOverlay(before, after, [beforeLabel, afterLabel])
				: buildSlider(before, after, [beforeLabel, afterLabel]);
	host.append(view);
}

function modes(root: ParentNode): Array<{ host: HTMLElement; mode: Mode }> {
	return [...root.querySelectorAll<HTMLElement>("x-compare")].map(host => {
		const raw = host.getAttribute("mode");
		const mode: Mode = raw === "side" || raw === "overlay" ? raw : "slider";
		return { host, mode };
	});
}

export async function render(root: ParentNode, _ctx: RenderContext): Promise<void> {
	const targets = modes(root);
	if (!targets.length) return;
	const needsSlider = targets.some(t => t.mode === "slider");
	if (needsSlider) await loadSlider();
	for (const { host, mode } of targets) renderOne(host, mode);
}

export function reset(root: ParentNode): void {
	for (const host of [...root.querySelectorAll<HTMLElement>("x-compare")]) {
		host.querySelector(":scope > .x-compare-view")?.remove();
		for (const img of host.querySelectorAll<HTMLImageElement>(":scope > img")) img.hidden = false;
	}
}

const module_: RendererModule = { render, reset };
export default module_;
