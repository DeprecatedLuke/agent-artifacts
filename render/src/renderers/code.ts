import type { RenderContext, RendererModule } from "./types";

/**
 * Syntax highlighting for every language Shiki bundles (~220 grammars), each
 * loaded on demand: a report only downloads the grammars it names. Fence names
 * may be grammar ids or aliases (`sh`, `yml`, `ts`, `rs`, `dockerfile`, ...).
 * An unknown name renders as plain, unhighlighted text.
 */

type GrammarModule = { default: unknown };
type GrammarLoader = () => Promise<GrammarModule>;

type CodeHighlighter = {
	codeToHtml(code: string, options: Record<string, unknown>): string;
	loadLanguage(...langs: unknown[]): Promise<void>;
};

/** Fence names Shiki does not know that clearly mean one of its grammars. */
const EXTRA_ALIASES: Record<string, string> = {
	docker: "dockerfile",
	golang: "go",
	"c++": "cpp",
	"c#": "csharp",
	cs: "csharp",
	dotnet: "csharp",
	postgres: "sql",
	psql: "sql",
	"shell-session": "shellsession",
};

/** Fence names that mean "do not highlight". */
const PLAIN: Record<string, true> = {
	text: true,
	plain: true,
	plaintext: true,
	txt: true,
	none: true,
	output: true,
	log: true,
	console: true,
};

let languagesPromise: Promise<Record<string, GrammarLoader>> | null = null;

function languages(): Promise<Record<string, GrammarLoader>> {
	languagesPromise ??= import("shiki/langs").then(
		mod => mod.bundledLanguages as unknown as Record<string, GrammarLoader>,
	);
	return languagesPromise;
}

let highlighterPromise: Promise<CodeHighlighter> | null = null;

function getHighlighter(): Promise<CodeHighlighter> {
	highlighterPromise ??= (async () => {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
			import("shiki/core"),
			import("shiki/engine/javascript"),
			import("@shikijs/themes/github-light"),
			import("@shikijs/themes/github-dark"),
		]);
		return (await createHighlighterCore({
			themes: [light.default, dark.default],
			langs: [],
			// JavaScript regex engine: no WASM fetch, no eval, so the report CSP holds.
			engine: createJavaScriptRegexEngine({ forgiving: true }),
		})) as unknown as CodeHighlighter;
	})();
	return highlighterPromise;
}

/** Grammars already handed to the highlighter, by grammar data (ids share data with aliases). */
const loadedGrammars = new Set<unknown>();

async function ensureLanguage(
	highlighter: CodeHighlighter,
	grammars: Record<string, GrammarLoader>,
	name: string,
): Promise<boolean> {
	const loader = grammars[name] ?? grammars[EXTRA_ALIASES[name] ?? ""];
	if (!loader) return false;
	const module_ = await loader();
	const grammar = module_.default;
	if (!loadedGrammars.has(grammar)) {
		await highlighter.loadLanguage(grammar);
		loadedGrammars.add(grammar);
	}
	return true;
}

/** Authored markup of every block we replaced, keyed by the highlighted <pre>. */
const saved = new Map<HTMLPreElement, string>();

export async function render(root: ParentNode, _ctx: RenderContext): Promise<void> {
	const blocks: Array<{ pre: HTMLPreElement; code: Element; lang: string }> = [];
	for (const pre of root.querySelectorAll<HTMLPreElement>("pre")) {
		const code = pre.firstElementChild;
		if (code?.tagName !== "CODE") continue;
		const match = /(?:^|\s)language-([\w+#.-]+)/.exec(code.className);
		if (!match) continue;
		blocks.push({ pre, code, lang: (match[1] ?? "").toLowerCase() });
	}
	if (!blocks.length) return;

	const [highlighter, grammars] = await Promise.all([getHighlighter(), languages()]);
	await Promise.all(
		blocks.map(async ({ pre, code, lang }) => {
			if (PLAIN[lang]) return;
			let known: boolean;
			try {
				known = await ensureLanguage(highlighter, grammars, lang);
			} catch (err) {
				console.error(`[artifacts] shiki cannot load "${lang}"`, err);
				return;
			}
			if (!known) return;

			const original = pre.outerHTML;
			let html: string;
			try {
				html = highlighter.codeToHtml(code.textContent ?? "", {
					lang,
					themes: { light: "github-light", dark: "github-dark" },
					// Emit `color: light-dark(...)` so one render serves both themes.
					defaultColor: "light-dark()",
				});
			} catch (err) {
				console.error(`[artifacts] shiki failed on "${lang}"`, err);
				return;
			}
			const template = document.createElement("template");
			template.innerHTML = html;
			const fresh = template.content.firstElementChild;
			if (!(fresh instanceof HTMLPreElement)) return;
			pre.replaceWith(fresh);
			saved.set(fresh, original);
		}),
	);
}

export function reset(root: ParentNode): void {
	for (const [pre, original] of saved) {
		if (!pre.isConnected || !root.contains(pre)) {
			saved.delete(pre);
			continue;
		}
		const template = document.createElement("template");
		template.innerHTML = original;
		const fresh = template.content.firstElementChild;
		if (fresh) pre.replaceWith(fresh);
		saved.delete(pre);
	}
}

const module_: RendererModule = { render, reset };
export default module_;
