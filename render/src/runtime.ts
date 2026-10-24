import { Idiomorph } from "idiomorph";
import { enhanceAll, unenhanceAll } from "./enhance";
import { renderAll, resetAll, themeAll } from "./pipeline";
import type { Theme } from "./renderers/types";

const SOURCE = "artifacts";
const REV = document.querySelector('meta[name="artifacts-rev"]')?.getAttribute("content") ?? "";

function systemTheme(): Theme {
	const scheme = getComputedStyle(document.documentElement).colorScheme;
	if (scheme === "dark") return "dark";
	if (scheme === "light") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let theme: Theme = systemTheme();
let explicitTheme = false;

/** All DOM work is serialized: renders, theme switches and updates never interleave. */
let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => void | Promise<void>): void {
	chain = chain.then(task).catch(err => console.error("[artifacts]", err));
}

function post(type: "ready" | "updated", extra: Record<string, unknown> = {}): void {
	window.parent.postMessage({ source: SOURCE, type, ...extra }, "*");
}

/* ------------------------------------------------------------- messages -- */

interface Incoming {
	source?: unknown;
	type?: unknown;
	scheme?: unknown;
	html?: unknown;
	rev?: unknown;
}

function parseIncoming(value: unknown): Incoming | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	return record.source === SOURCE ? record : null;
}

window.addEventListener("message", event => {
	const data = parseIncoming(event.data);
	if (!data) return;
	if (data.type === "theme") {
		const scheme: Theme = data.scheme === "dark" ? "dark" : "light";
		explicitTheme = true;
		theme = scheme;
		document.documentElement.style.colorScheme = scheme;
		// Mermaid rebuilds its figures for the new palette, so their viewer
		// affordances have to be re-applied.
		enqueue(async () => {
			await themeAll(document, theme);
			enhanceAll();
		});
		return;
	}
	if (data.type === "update" && typeof data.html === "string") {
		const rev = data.rev ?? REV;
		const html = data.html;
		enqueue(() => applyUpdate(html, rev));
	}
});

async function applyUpdate(html: string, rev: unknown): Promise<void> {
	const x = window.scrollX;
	const y = window.scrollY;
	// Put the authored markup back first, so idiomorph morphs raw HTML onto raw
	// HTML instead of reconciling generated SVG/token spans, table wrappers or a
	// contents sidebar that the new source does not contain.
	unenhanceAll();
	resetAll(document);
	await Idiomorph.morph(document.body, html, { morphStyle: "innerHTML" });
	await renderAll(document, theme);
	enhanceAll();
	formatTimes(document);
	runInlineScripts(document);
	window.scrollTo(x, y);
	requestAnimationFrame(() => window.scrollTo(x, y));
	post("updated", { rev });
}

/* ------------------------------------------------------------ timestamps -- */

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

/** RFC3339 allows arbitrary fractional precision; JS Date only parses milliseconds. */
function parseTimestamp(value: string): Date | null {
	const date = new Date(value.replace(/\.(\d{3})\d+/, ".$1"));
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The server writes the raw RFC3339 string as the visible text; show the
 * reader's local time instead and keep the exact value in `title`.
 */
function formatTimes(root: ParentNode): void {
	for (const time of root.querySelectorAll<HTMLTimeElement>(".report-meta time[datetime]")) {
		const raw = time.getAttribute("datetime");
		if (!raw) continue;
		const date = parseTimestamp(raw);
		if (!date) continue;
		time.title = raw;
		time.textContent = TIME_FORMAT.format(date);
	}
}

/* ------------------------------------------------------- inline scripts -- */

const executed = new WeakSet<HTMLScriptElement>();

function runInlineScripts(root: ParentNode): void {
	// Only report content scripts are candidates; the runtime's own document
	// head must never be re-executed on an update.
	const scope = root.querySelector("#report-body") ?? root;
	for (const script of scope.querySelectorAll<HTMLScriptElement>("script:not([src])")) {
		if (executed.has(script)) continue;
		const type = script.type;
		executed.add(script);
		if (type && type !== "module" && type !== "text/javascript") continue;
		const clone = document.createElement("script");
		if (type) clone.type = type;
		clone.textContent = script.textContent;
		script.replaceWith(clone);
		executed.add(clone);
	}
}

/* --------------------------------------------------------- interactions -- */

function jumpTo(hash: string): void {
	let id = hash;
	try {
		id = decodeURIComponent(hash);
	} catch {
		/* keep the raw value */
	}
	if (!id) {
		window.scrollTo({ top: 0 });
		return;
	}
	const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
	target?.scrollIntoView({ block: "start" });
}

function activateTab(tabs: Element, index: number): void {
	const sections = [...tabs.children].filter((child): child is HTMLElement => child.tagName === "SECTION");
	if (!sections.length) return;
	const active = Math.min(Math.max(index, 0), sections.length - 1);
	sections.forEach((section, i) => {
		section.hidden = i !== active;
	});
	const buttons = [...tabs.querySelectorAll<HTMLButtonElement>(":scope > .x-tabbar > button")];
	buttons.forEach((button, i) => {
		button.setAttribute("aria-selected", String(i === active));
		button.tabIndex = i === active ? 0 : -1;
	});
	buttons[active]?.focus();
}

function onClick(event: MouseEvent): void {
	const target = event.target instanceof Element ? event.target : null;
	if (!target) return;

	const anchor = target.closest("a");
	if (anchor) {
		const href = anchor.getAttribute("href") ?? "";
		if (href.startsWith("#")) {
			// The document has <base target=_blank>; a hash link must stay in place.
			event.preventDefault();
			jumpTo(href.slice(1));
			return;
		}
	}

	const tab = target.closest<HTMLElement>("button[data-x-tab]");
	if (tab) {
		const tabs = tab.closest("x-tabs");
		if (tabs) {
			event.preventDefault();
			activateTab(tabs, Number(tab.dataset.xTab));
		}
	}
}

function onKeydown(event: KeyboardEvent): void {
	const target = event.target;
	if (!(target instanceof HTMLElement) || !target.matches("button[data-x-tab]")) return;
	const tabs = target.closest("x-tabs");
	if (!tabs) return;
	const buttons = [...tabs.querySelectorAll<HTMLButtonElement>(":scope > .x-tabbar > button")];
	const index = buttons.indexOf(target as HTMLButtonElement);
	const last = buttons.length - 1;
	let next: number;
	if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
	else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
	else if (event.key === "Home") next = 0;
	else if (event.key === "End") next = last;
	else return;
	event.preventDefault();
	activateTab(tabs, next);
}

function installInteractions(): void {
	document.addEventListener("click", onClick);
	document.addEventListener("keydown", onKeydown);
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	media.addEventListener("change", () => {
		if (explicitTheme) return;
		theme = systemTheme();
		enqueue(() => themeAll(document, theme));
	});
}

/* ------------------------------------------------------------------ boot -- */

installInteractions();

enqueue(async () => {
	for (const script of document.querySelectorAll("script")) executed.add(script as HTMLScriptElement);
	await renderAll(document, theme);
	// After the renderers: Mermaid figures and tablesort must exist to be enhanced.
	enhanceAll();
	formatTimes(document);
	post("ready", { rev: REV });
});
