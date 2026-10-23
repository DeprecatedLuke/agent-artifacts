/** Small DOM helpers shared by the renderers. */

export function create<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

/** Reads and parses the `<script type="application/json">` payload of a component. */
export function jsonPayload(host: Element): unknown {
	const script = host.querySelector('script[type="application/json"]');
	if (!script) throw new Error('missing <script type="application/json"> child');
	return JSON.parse(script.textContent ?? "");
}

/** Raw text of the first `<script type="text/plain">` child, or the element's text. */
export function textPayload(host: Element): string {
	const script = host.querySelector('script[type="text/plain"]');
	return (script ?? host).textContent ?? "";
}

/** Adds an inline render error instead of breaking the whole page. */
export function renderError(host: Element, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	const box = create("div", "x-error", message);
	box.setAttribute("role", "alert");
	host.append(box);
}

/** Two images of a compare component (first = before). */
export function compareImages(host: Element): [HTMLImageElement, HTMLImageElement] | null {
	const imgs = [...host.querySelectorAll<HTMLImageElement>(":scope > img")];
	const first = imgs[0];
	const second = imgs[1];
	return first && second ? [first, second] : null;
}
