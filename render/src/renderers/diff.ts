import type { FileDiff, FileDiffMetadata, FileDiffOptions, ParsedPatch, SupportedLanguages } from "@pierre/diffs";
import { create, renderError, textPayload } from "./dom";
import type { RenderContext, RendererModule, Theme } from "./types";

/**
 * `<x-diff>` renders with @pierre/diffs, the Shiki-based diff viewer. Each file
 * renders into its own shadow root, so report.css cannot reach its tables,
 * gutters or token spans (that leak is what broke the old diff2html gutters),
 * and it brings correct old/new line numbers, red/green word-level diffing, a
 * file header and per-file language detection from the filename.
 *
 * Only documents with an `<x-diff>` pay for the library (lazy import).
 */

interface DiffLibrary {
	newView(options: FileDiffOptions<undefined, undefined>): FileDiff;
	parse(patch: string): ParsedPatch[];
	forceLanguage(file: FileDiffMetadata, lang: string): FileDiffMetadata;
}

const THEMES = { light: "github-light", dark: "github-dark" };

let library: Promise<{ api: DiffLibrary; languages: Set<string> }> | null = null;

function load(): Promise<{ api: DiffLibrary; languages: Set<string> }> {
	library ??= Promise.all([import("@pierre/diffs"), import("shiki/langs")]).then(([diffs, langs]) => ({
		api: {
			newView: options => new diffs.FileDiff(options),
			parse: patch => diffs.parsePatchFiles(patch),
			forceLanguage: (file, lang) => diffs.setLanguageOverride(file, lang as SupportedLanguages),
		},
		// Every grammar id and alias Shiki bundles, so `lang="py"` or `lang="yml"` works.
		languages: new Set([...Object.keys(langs.bundledLanguages), ...Object.keys(langs.bundledLanguagesAlias)]),
	}));
	return library;
}

interface HostState {
	view: HTMLElement;
	views: FileDiff[];
}

const states = new WeakMap<Element, HostState>();

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** True when line `i` opens a file header (`--- x` directly followed by `+++ y`). */
function isFileHeader(lines: string[], i: number): boolean {
	return (lines[i] ?? "").startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ");
}

/** `a/src/x.rs` -> `src/x.rs`; `/dev/null` and unprefixed paths stay as they are. */
function stripGitPrefix(path: string, prefix: "a/" | "b/"): string {
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Agents write diffs by hand and routinely get the `@@ -a,b +c,d @@` counts
 * wrong; @pierre/diffs then swallows the next file header into the hunk. This
 * recomputes every hunk's old/new counts from its actual lines (context: both,
 * `-`: old, `+`: new, `\ No newline`: neither) and keeps the start lines and
 * the section text. A hunk ends at the next `@@`, `diff --git`, or a `--- `
 * line directly followed by `+++ `.
 *
 * It also drops git's `a/` and `b/` path prefixes from `---`/`+++` headers, so
 * a plain modification is labelled `src/x.rs` instead of reading as a rename.
 */
export function normalizePatch(payload: string): string {
	const lines = payload.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (isFileHeader(lines, i)) {
			const oldPath = line.slice(4);
			const newPath = (lines[i + 1] ?? "").slice(4);
			// Only strip when the pair follows git's convention, so a real
			// directory named `a/` or `b/` in a non-git diff is left alone.
			const git = oldPath.startsWith("a/") || newPath.startsWith("b/");
			const gitOld = oldPath === "/dev/null" || oldPath.startsWith("a/");
			const gitNew = newPath === "/dev/null" || newPath.startsWith("b/");
			const strip = git && gitOld && gitNew;
			out.push(`--- ${strip ? stripGitPrefix(oldPath, "a/") : oldPath}`);
			out.push(`+++ ${strip ? stripGitPrefix(newPath, "b/") : newPath}`);
			i += 2;
			continue;
		}
		const hunk = HUNK.exec(line);
		if (!hunk) {
			out.push(line);
			i++;
			continue;
		}
		const body: string[] = [];
		let oldCount = 0;
		let newCount = 0;
		i++;
		while (i < lines.length) {
			const next = lines[i] ?? "";
			if (next.startsWith("@@") || next.startsWith("diff --git ") || isFileHeader(lines, i)) break;
			const marker = next[0];
			if (marker === "-") oldCount++;
			else if (marker === "+") newCount++;
			else if (marker === "\\") {
				// "\ No newline at end of file" belongs to neither side.
			} else if (marker === " " || next === "" || next === "\r") {
				oldCount++;
				newCount++;
			} else break;
			body.push(next);
			i++;
		}
		// A trailing blank line is the gap before the next file, not context.
		while (body.length && (body.at(-1) === "" || body.at(-1) === "\r")) {
			body.pop();
			oldCount--;
			newCount--;
		}
		out.push(`@@ -${hunk[1]},${oldCount} +${hunk[2]},${newCount} @@${hunk[3] ?? ""}`, ...body);
	}
	return out.join("\n");
}

function clear(host: Element): void {
	const state = states.get(host);
	if (state) {
		states.delete(host);
		for (const view of state.views) {
			try {
				view.cleanUp();
			} catch {
				/* already cleaned up */
			}
		}
		state.view.remove();
	}
	for (const node of [...host.querySelectorAll(":scope > .x-diff-view, :scope > .x-error")]) node.remove();
}

function renderOne(api: DiffLibrary, languages: Set<string>, host: HTMLElement, theme: Theme): void {
	clear(host);
	// The payload sits inside HTML, so it usually ends with indentation and a
	// newline; a whitespace-only trailing line would count as a bad hunk line.
	const payload = normalizePatch(
		textPayload(host)
			.replace(/^[ \t]*\n/, "")
			.replace(/\s+$/, ""),
	);
	if (!payload.trim()) return;

	let files: FileDiffMetadata[];
	try {
		files = api.parse(payload).flatMap(patch => patch.files);
	} catch (err) {
		renderError(host, err);
		return;
	}
	if (!files.length) {
		renderError(host, new Error("no `---`/`+++` file header in the diff payload"));
		return;
	}

	// `lang` forces one grammar for every file; otherwise each file is detected
	// from its name in the diff headers.
	const requested = (host.getAttribute("lang") ?? "").trim().toLowerCase();
	const forced = languages.has(requested) ? requested : null;

	const options: FileDiffOptions<undefined, undefined> = {
		theme: THEMES,
		themeType: theme,
		diffStyle: host.getAttribute("mode") === "side" ? "split" : "unified",
		diffIndicators: "classic",
		lineDiffType: "word-alt",
		overflow: "scroll",
	};

	// The view has to be in the document while each file renders: @pierre/diffs
	// measures its container and paints on the next frame.
	const view = create("div", "x-diff-view");
	const views: FileDiff[] = [];
	host.append(view);
	states.set(host, { view, views });
	for (const file of files) {
		const slot = create("div", "x-diff-file");
		view.append(slot);
		const instance = api.newView(options);
		views.push(instance);
		try {
			instance.render({
				fileDiff: forced ? api.forceLanguage(file, forced) : file,
				containerWrapper: slot,
			});
		} catch (err) {
			slot.remove();
			renderError(host, err);
		}
	}

	if (!view.childElementCount) clear(host);
}

export async function render(root: ParentNode, ctx: RenderContext): Promise<void> {
	const hosts = [...root.querySelectorAll<HTMLElement>("x-diff")];
	if (!hosts.length) return;
	const { api, languages } = await load();
	for (const host of hosts) renderOne(api, languages, host, ctx.theme);
}

export function reset(root: ParentNode): void {
	for (const host of [...root.querySelectorAll<HTMLElement>("x-diff")]) clear(host);
}

/** A theme switch is a shadow-root restyle, not a re-render. */
export function theme(root: ParentNode, ctx: RenderContext): void {
	for (const host of [...root.querySelectorAll<HTMLElement>("x-diff")]) {
		const state = states.get(host);
		if (!state) continue;
		for (const view of state.views) view.setThemeType(ctx.theme);
	}
}

const module_: RendererModule = { render, reset, theme };
export default module_;
