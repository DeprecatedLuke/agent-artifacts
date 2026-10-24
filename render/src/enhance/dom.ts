/**
 * DOM helpers for the always-loaded enhancements. Deliberately not shared with
 * `renderers/dom.ts`: a module imported by both runtime.js and a lazy renderer
 * chunk would be hoisted into the entry, and the chunk would then import
 * runtime.js a second time (see the manualChunks note in vite.config.ts).
 */

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** `classList.remove` leaves `class=""` behind; the authored markup had no attribute. */
export function dropClass(node: Element, name: string): void {
	node.classList.remove(name);
	if (!node.classList.length) node.removeAttribute("class");
}

/** The report fragment; enhancements never touch the server-rendered header. */
export function reportBody(): HTMLElement | null {
	return document.getElementById("report-body");
}
