/**
 * Fullscreen viewer for anything in a report that is worth looking at closely:
 * images, rendered Mermaid diagrams and tables.
 *
 * One overlay element serves all three. It asks for the Fullscreen API element
 * fullscreen and keeps the fixed, viewport-covering overlay as the fallback:
 * a sandboxed iframe without `allow="fullscreen"` (split view) rejects the
 * request, and the report still gets a usable viewer.
 */

import { dropClass, el } from "./dom";

const ZOOM = "data-report-zoom";
/** Marks the attributes this module added, so un-enhancing can remove exactly those. */
const ADDED_TABINDEX = "data-report-tabindex";
const ADDED_ROLE = "data-report-role";
/** Images that render smaller than this are decoration and stay inert. */
const MIN_SIZE = 48;
/** The wrapper `tables.ts` builds; a table moved into the viewer comes from one. */
const TABLE_WRAP = "report-table";

let overlay: HTMLElement | null = null;
let trigger: HTMLElement | SVGElement | null = null;
/** Puts a table that was moved into the viewer back where it belongs. */
let restoreTable: (() => void) | null = null;
let onFullscreen: (() => void) | null = null;
let installed = false;

function tooSmall(img: HTMLImageElement): boolean {
	const rect = img.getBoundingClientRect();
	// Before the image loads (and while it is display:none) the rect is 0: fall
	// back to the intrinsic size so a real figure is never mistaken for an icon.
	return Math.max(rect.width || img.naturalWidth, rect.height || img.naturalHeight) < MIN_SIZE;
}

function mark(target: Element, kind: "image" | "diagram"): void {
	target.setAttribute(ZOOM, kind);
	target.classList.add("report-zoomable");
	if (!target.hasAttribute("tabindex")) {
		target.setAttribute("tabindex", "0");
		target.setAttribute(ADDED_TABINDEX, "");
	}
	if (kind === "diagram" && !target.hasAttribute("role")) {
		// A focusable svg with no role is announced as nothing useful.
		target.setAttribute("role", "button");
		target.setAttribute(ADDED_ROLE, "");
	}
}

function unmark(target: Element): void {
	target.removeAttribute(ZOOM);
	dropClass(target, "report-zoomable");
	if (target.hasAttribute(ADDED_TABINDEX)) {
		target.removeAttribute("tabindex");
		target.removeAttribute(ADDED_TABINDEX);
	}
	if (target.hasAttribute(ADDED_ROLE)) {
		target.removeAttribute("role");
		target.removeAttribute(ADDED_ROLE);
	}
}

function fillImage(stage: HTMLElement, source: HTMLImageElement): void {
	const view = el("img", "report-viewer-image");
	view.alt = source.alt;
	if (source.srcset) view.srcset = source.srcset;
	if (source.sizes) view.sizes = source.sizes;
	view.src = source.currentSrc || source.src;
	view.addEventListener("click", () => {
		// Natural size is only worth toggling when it is bigger than the fit.
		if (view.classList.contains("is-natural")) {
			dropClass(view, "is-natural");
			return;
		}
		const rect = view.getBoundingClientRect();
		if (view.naturalWidth <= Math.ceil(rect.width) && view.naturalHeight <= Math.ceil(rect.height)) return;
		view.classList.add("is-natural");
	});
	stage.append(view);
}

function fillDiagram(stage: HTMLElement, source: SVGElement): void {
	// A clone: the inline diagram keeps its place in the report. Its ids are
	// duplicated, which is harmless here because the clone carries the same
	// styles and markers, so `url(#…)` resolves to identical content.
	const clone = source.cloneNode(true) as SVGElement;
	// Mermaid writes an inline max-width for the inline figure; the viewer scales
	// from the viewBox instead.
	clone.removeAttribute("style");
	unmark(clone);
	clone.classList.add("report-viewer-diagram");
	stage.append(clone);
}

function fillTable(stage: HTMLElement, table: HTMLTableElement): void {
	const wrap = table.closest<HTMLElement>(`.${TABLE_WRAP}`);
	// The real node moves, so `table.sortable` keeps its listeners and sort state.
	const marker = document.createComment("report-table");
	table.before(marker);
	if (wrap) {
		// Keep the page height while the table is out, or closing the viewer jumps.
		const height = wrap.getBoundingClientRect().height;
		if (height) wrap.style.minHeight = `${Math.round(height)}px`;
	}
	table.classList.add("report-viewer-table");
	stage.append(table);
	restoreTable = () => {
		marker.replaceWith(table);
		dropClass(table, "report-viewer-table");
		if (wrap) {
			wrap.style.removeProperty("min-height");
			if (!wrap.getAttribute("style")) wrap.removeAttribute("style");
		}
	};
}

function closeViewer(): void {
	const root = overlay;
	if (!root) return;
	const previous = trigger;
	const restore = restoreTable;
	overlay = null;
	trigger = null;
	restoreTable = null;
	restore?.();
	if (onFullscreen) {
		document.removeEventListener("fullscreenchange", onFullscreen);
		onFullscreen = null;
	}
	if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
	root.remove();
	dropClass(document.documentElement, "report-viewer-open");
	if (previous?.isConnected) previous.focus({ preventScroll: true });
}

function open(label: string, source: HTMLElement | SVGElement, fill: (stage: HTMLElement) => void): void {
	closeViewer();
	const root = el("div", "report-viewer");
	root.setAttribute("role", "dialog");
	root.setAttribute("aria-modal", "true");
	root.setAttribute("aria-label", label);
	const closeButton = el("button", "report-viewer-close");
	closeButton.type = "button";
	closeButton.setAttribute("aria-label", "Close");
	const stage = el("div", "report-viewer-stage");
	root.append(closeButton, stage);
	document.body.append(root);
	overlay = root;
	trigger = source;
	closeButton.addEventListener("click", closeViewer);
	root.addEventListener("click", event => {
		// Clicks that reach the dialog or its stage (not a child) are backdrop clicks.
		if (event.target === root || event.target === stage) closeViewer();
	});
	document.documentElement.classList.add("report-viewer-open");
	fill(stage);
	if (document.fullscreenEnabled && typeof root.requestFullscreen === "function") {
		onFullscreen = () => {
			if (document.fullscreenElement !== root) closeViewer();
		};
		document.addEventListener("fullscreenchange", onFullscreen);
		// A rejection is expected in an iframe without `allow="fullscreen"`.
		root.requestFullscreen().catch(() => {});
	}
	closeButton.focus();
}

function openZoomable(target: Element): void {
	if (target instanceof HTMLImageElement) {
		open("Enlarged image", target, stage => fillImage(stage, target));
		return;
	}
	if (target instanceof SVGElement) open("Enlarged diagram", target, stage => fillDiagram(stage, target));
}

export function openTable(table: HTMLTableElement, from: HTMLElement): void {
	open("Expanded table", from, stage => fillTable(stage, table));
}

function onClick(event: MouseEvent): void {
	const target = event.target instanceof Element ? event.target : null;
	const zoomable = target?.closest(`[${ZOOM}]`);
	if (zoomable) openZoomable(zoomable);
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") {
		if (!overlay) return;
		event.preventDefault();
		closeViewer();
		return;
	}
	if (event.key !== "Enter" && event.key !== " ") return;
	const target = event.target instanceof Element ? event.target : null;
	const zoomable = target?.closest(`[${ZOOM}]`);
	if (!zoomable) return;
	event.preventDefault();
	openZoomable(zoomable);
}

export function enhanceViewer(body: HTMLElement): void {
	if (!installed) {
		installed = true;
		document.addEventListener("click", onClick);
		document.addEventListener("keydown", onKeydown);
	}
	for (const img of body.querySelectorAll("img")) {
		if (img.hasAttribute(ZOOM)) continue;
		// A linked image belongs to its link, a compare slider owns its own
		// interaction, and x-icon is an icon set.
		if (img.closest("a, x-compare, x-icon, .report-viewer")) continue;
		if (img.complete) {
			if (tooSmall(img)) continue;
			mark(img, "image");
			continue;
		}
		// Not loaded yet: the rendered size is unknown, so decide on load.
		img.addEventListener(
			"load",
			() => {
				if (!tooSmall(img) && !img.hasAttribute(ZOOM)) mark(img, "image");
			},
			{ once: true },
		);
	}
	for (const svg of body.querySelectorAll(".mermaid-figure svg")) {
		if (!svg.hasAttribute(ZOOM)) mark(svg, "diagram");
	}
}

export function unenhanceViewer(): void {
	closeViewer();
	for (const target of document.querySelectorAll(`[${ZOOM}]`)) unmark(target);
}
