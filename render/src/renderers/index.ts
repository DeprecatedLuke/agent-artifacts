import type { RendererSpec } from "./types";

/**
 * Registry of component renderers. Each `load` is a real dynamic import so the
 * heavy libraries stay out of runtime.js and are fetched only when a report uses
 * that component. (`await import("...")` is required here: the set of libraries
 * to load genuinely depends on the document at runtime.)
 */

const IGNORED = "pre, code, script, style, textarea, option, .mermaid, x-chart, x-diff, x-metric";

/** Walks text nodes the way the KaTeX auto-renderer does and looks for delimiters. */
function hasMathMarkup(root: ParentNode): boolean {
	const doc = root.ownerDocument ?? document;
	const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (parent.closest(IGNORED)) return NodeFilter.FILTER_REJECT;
			return /[$]|\\\(|\\\[/.test(node.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
		},
	});
	return walker.nextNode() !== null;
}

export const specs: RendererSpec[] = [
	{
		name: "math",
		detect: hasMathMarkup,
		load: () => import("./math"),
	},
	{
		name: "mermaid",
		detect: root => !!root.querySelector("pre.mermaid"),
		load: () => import("./mermaid"),
	},
	{
		name: "chart",
		detect: root => !!root.querySelector("x-chart"),
		load: () => import("./chart"),
	},
	{
		name: "code",
		detect: root => !!root.querySelector("pre > code[class*='language-']"),
		load: () => import("./code"),
	},
	{
		name: "diff",
		detect: root => !!root.querySelector("x-diff"),
		load: () => import("./diff"),
	},
	{
		name: "compare",
		detect: root => !!root.querySelector("x-compare"),
		load: () => import("./compare"),
	},
	{
		name: "icons",
		detect: root => !!root.querySelector("x-icon"),
		load: () => import("./icon"),
	},
	{
		name: "elements",
		detect: root => !!root.querySelector("x-tabs, x-metric, table.sortable"),
		load: () => import("./elements"),
	},
];
