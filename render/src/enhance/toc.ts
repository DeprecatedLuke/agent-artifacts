/**
 * Contents sidebar, built from the report's own headings.
 *
 * Agents write sections, not navigation, so the runtime derives it: the two
 * highest heading levels present among h1-h4 become the entries, and a report
 * with fewer than three entries gets no sidebar at all. Headings keep existing
 * ids; missing ones get a generated slug that un-enhancing removes again, so a
 * live update morphs the authored markup, not this module's anchors.
 *
 * Layout lives in report.css (a fixed right column above 1200px, a popover
 * behind a toggle button below it); this module only owns state.
 */

import { dropClass, el } from "./dom";

const ANCHOR = "data-report-anchor";
/** Headings under these are not part of the document outline the reader navigates. */
const EXCLUDE = "x-tabs, details, aside, figure, table, .report-viewer, .report-toc";
/** Entries below three are not a table of contents, they are a paragraph. */
const MIN_ENTRIES = 3;
/** A heading this close to the viewport top counts as the section being read. */
const SPY_OFFSET = 120;

interface Entry {
	heading: HTMLElement;
	link: HTMLAnchorElement;
}

let nav: HTMLElement | null = null;
let toggle: HTMLButtonElement | null = null;
let entries: Entry[] = [];
let frame = 0;
let cleanups: (() => void)[] = [];

function textOf(node: Element): string {
	return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

function levelOf(heading: Element): number {
	return Number(heading.tagName[1]);
}

/** ASCII slug: an anchor is a URL fragment, not a translation of the heading. */
function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function ensureId(heading: HTMLElement): string {
	if (heading.id) return heading.id;
	const base = slug(textOf(heading)) || "section";
	let candidate = base;
	let suffix = 1;
	while (document.getElementById(candidate)) candidate = `${base}-${suffix++}`;
	heading.setAttribute("id", candidate);
	heading.setAttribute(ANCHOR, "");
	return candidate;
}

function setOpen(open: boolean): void {
	if (!nav || !toggle) return;
	nav.classList.toggle("is-open", open);
	toggle.setAttribute("aria-expanded", String(open));
}

function spy(): void {
	if (!entries.length) return;
	const doc = document.documentElement;
	let active = entries[0];
	if (window.scrollY + window.innerHeight >= doc.scrollHeight - 2) {
		// At the very bottom the last section is being read, even when its heading
		// is still below the offset line.
		active = entries[entries.length - 1];
	} else {
		for (const entry of entries) {
			if (entry.heading.getBoundingClientRect().top > SPY_OFFSET) break;
			active = entry;
		}
	}
	for (const entry of entries) {
		const current = entry === active;
		entry.link.classList.toggle("is-active", current);
		if (current) entry.link.setAttribute("aria-current", "true");
		else entry.link.removeAttribute("aria-current");
	}
}

function schedule(): void {
	if (frame) return;
	frame = requestAnimationFrame(() => {
		frame = 0;
		spy();
	});
}

function listen(root: HTMLElement, button: HTMLButtonElement): void {
	const onToggle = (event: MouseEvent): void => {
		// The document listener below closes the popover on any click; the button's
		// own click must not immediately close what it just opened.
		event.stopPropagation();
		setOpen(!root.classList.contains("is-open"));
	};
	const onClick = (event: MouseEvent): void => {
		const target = event.target instanceof Element ? event.target : null;
		if (target && root.contains(target)) {
			// The runtime's own hash handling does the jump; just get out of the way.
			if (target.closest("a")) setOpen(false);
			return;
		}
		setOpen(false);
	};
	const onKeydown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") setOpen(false);
	};
	button.addEventListener("click", onToggle);
	document.addEventListener("click", onClick);
	document.addEventListener("keydown", onKeydown);
	window.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule);
	cleanups.push(() => {
		button.removeEventListener("click", onToggle);
		document.removeEventListener("click", onClick);
		document.removeEventListener("keydown", onKeydown);
		window.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", schedule);
	});
}

export function enhanceToc(body: HTMLElement): void {
	if (nav) return;
	const headings = [...body.querySelectorAll<HTMLElement>("h1, h2, h3, h4")].filter(
		heading => !heading.closest(EXCLUDE) && textOf(heading) !== "",
	);
	if (headings.length < MIN_ENTRIES) return;
	const levels = [...new Set(headings.map(levelOf))].sort((a, b) => a - b).slice(0, 2);
	const selected = headings.filter(heading => levels.includes(levelOf(heading)));
	if (selected.length < MIN_ENTRIES) return;
	const base = levels[0] ?? 1;

	const root = el("nav", "report-toc");
	root.setAttribute("aria-label", "Contents");
	const list = el("ul", "report-toc-list");
	const built: Entry[] = [];
	for (const heading of selected) {
		const item = el("li", "report-toc-item");
		item.dataset.level = String(levelOf(heading) - base + 1);
		const link = el("a", "report-toc-link");
		link.href = `#${ensureId(heading)}`;
		link.textContent = textOf(heading);
		item.append(link);
		list.append(item);
		built.push({ heading, link });
	}
	root.append(el("div", "report-toc-title", "Contents"), list);

	const button = el("button", "report-toc-toggle");
	button.type = "button";
	button.setAttribute("aria-label", "Contents");
	button.setAttribute("aria-expanded", "false");

	document.body.append(root, button);
	nav = root;
	toggle = button;
	entries = built;
	document.documentElement.classList.add("report-has-toc");
	listen(root, button);
	spy();
}

export function unenhanceToc(body: HTMLElement): void {
	for (const cleanup of cleanups) cleanup();
	cleanups = [];
	if (frame) {
		cancelAnimationFrame(frame);
		frame = 0;
	}
	nav?.remove();
	toggle?.remove();
	nav = null;
	toggle = null;
	entries = [];
	dropClass(document.documentElement, "report-has-toc");
	for (const heading of body.querySelectorAll<HTMLElement>(`[${ANCHOR}]`)) {
		heading.removeAttribute("id");
		heading.removeAttribute(ANCHOR);
	}
}
