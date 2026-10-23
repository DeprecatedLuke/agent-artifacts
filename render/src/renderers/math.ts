import type { RenderContext, RendererModule } from "./types";

type AutoRender = (
	element: HTMLElement,
	options: {
		delimiters: Array<{ left: string; right: string; display: boolean }>;
		ignoredTags: string[];
		ignoredClasses: string[];
		throwOnError: boolean;
	},
) => void;

let autoRender: Promise<AutoRender> | null = null;

function load(): Promise<AutoRender> {
	autoRender ??= (async () => {
		// Static import of katex's stylesheet would ship it with runtime.js; the
		// CSS (and its fonts) must only load when a report actually has math.
		const [mod] = await Promise.all([import("katex/contrib/auto-render"), import("katex/dist/katex.min.css")]);
		return (mod.default ?? mod) as unknown as AutoRender;
	})();
	return autoRender;
}

export function render(root: ParentNode, _ctx: RenderContext): Promise<void> {
	return load().then(renderMathIn => {
		renderMathIn(root as HTMLElement, {
			delimiters: [
				{ left: "$$", right: "$$", display: true },
				{ left: "\\[", right: "\\]", display: true },
				{ left: "\\(", right: "\\)", display: false },
				{ left: "$", right: "$", display: false },
			],
			ignoredTags: ["pre", "code", "script", "style", "textarea", "option", "x-chart", "x-diff"],
			ignoredClasses: ["mermaid"],
			throwOnError: false,
		});
	});
}

/** Replace every rendered formula with its original TeX delimiters again. */
export function reset(root: ParentNode): void {
	for (const katex of [...root.querySelectorAll<HTMLElement>(".katex")]) {
		if (!katex.isConnected) continue;
		const display = katex.parentElement?.classList.contains("katex-display") ?? false;
		const wrapper = display ? (katex.parentElement as HTMLElement) : katex;
		const annotation = katex.querySelector('annotation[encoding="application/x-tex"]');
		const tex = annotation?.textContent ?? katex.textContent ?? "";
		wrapper.replaceWith(document.createTextNode(display ? `$$${tex}$$` : `$${tex}$`));
	}
	for (const broken of [...root.querySelectorAll<HTMLElement>(".katex-error")]) {
		broken.replaceWith(document.createTextNode(broken.textContent ?? ""));
	}
}

const module_: RendererModule = { render, reset };
export default module_;
