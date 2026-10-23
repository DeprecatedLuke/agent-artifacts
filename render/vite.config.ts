import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const HEROICONS = new URL("./node_modules/heroicons/", import.meta.url);
const ICON_SET = "20/solid";

/**
 * Code points the server rejects in a report (arrows, geometric shapes, misc
 * symbols, dingbats, emoji) — the same policy as `server/src/source.rs`. Every
 * glyph in a report is a Heroicons `<x-icon>` or an `icon("…")` mask; this build
 * refuses to ship source that would emit one as text.
 */
const BANNED_RANGES: readonly (readonly [number, number])[] = [
	[0x2190, 0x21ff],
	[0x27f0, 0x27ff],
	[0x2900, 0x297f],
	[0x1f800, 0x1f8ff],
	[0x2b00, 0x2bff],
	[0x25a0, 0x25ff],
	[0x2600, 0x26ff],
	[0x2700, 0x27bf],
	[0x1f000, 0x1faff],
	[0x231a, 0x231b],
	[0x23e9, 0x23f3],
	[0x23f8, 0x23fa],
	[0x2139, 0x2139],
	[0xfe0f, 0xfe0f],
];

/** First banned code point in `text`, with its 1-based line, or null. */
function bannedGlyph(text: string): { char: string; code: number; line: number } | null {
	let line = 1;
	for (const char of text) {
		if (char === "\n") line++;
		const code = char.codePointAt(0) ?? 0;
		for (const [from, to] of BANNED_RANGES) {
			if (code >= from && code <= to) return { char, code, line };
		}
	}
	return null;
}

/** Recursively reads every file under `dir` as text. */
function walk(dir: URL, suffix: string): URL[] {
	const out: URL[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
		if (entry.isDirectory()) out.push(...walk(child, suffix));
		else if (entry.name.endsWith(suffix)) out.push(child);
	}
	return out;
}

/** Heroicons 20/solid, read once from the installed package: `{set, version, icons:{name: svg}}`. */
function loadIcons() {
	const dir = new URL(`${ICON_SET}/`, HEROICONS);
	const icons: Record<string, string> = {};
	for (const file of readdirSync(dir).sort()) {
		if (file.endsWith(".svg")) icons[file.slice(0, -4)] = readFileSync(new URL(file, dir), "utf8").trim();
	}
	const { version } = JSON.parse(readFileSync(new URL("package.json", HEROICONS), "utf8")) as { version: string };
	return { set: ICON_SET, version, icons };
}

/** `icon("name")` in report.css → a data-URI SVG usable as `mask-image`. */
function inlineCssIcons(css: string, icons: Record<string, string>): string {
	return css.replace(/icon\("([a-z0-9-]+)"\)/g, (_, name: string) => {
		const svg = icons[name];
		if (!svg) throw new Error(`report.css: unknown heroicon "${name}"`);
		return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
	});
}

/**
 * One source for every icon consumer: the lazily imported `virtual:heroicons`
 * chunk (x-icon runtime), dist/icons.json (server validation) and the CSS masks
 * in dist/report.css (emitted verbatim apart from `icon()` substitution).
 */
function heroicons(): Plugin {
	const data = loadIcons();
	const VIRTUAL = "virtual:heroicons";
	const SRC = new URL("./src/", import.meta.url);
	return {
		name: "artifacts-heroicons",
		buildStart() {
			for (const file of [...walk(SRC, ".ts"), ...walk(SRC, ".css")]) {
				const found = bannedGlyph(readFileSync(file, "utf8"));
				if (!found) continue;
				this.error(
					`${file.pathname.split("/src/")[1]}:${found.line}: "${found.char}" (U+${found.code
						.toString(16)
						.toUpperCase()
						.padStart(
							4,
							"0",
						)}) — use <x-icon name="…"> (heroicons.com) or an icon("…") CSS mask, not a unicode glyph`,
				);
			}
		},
		resolveId(id) {
			if (id === VIRTUAL) return `\0${VIRTUAL}`;
		},
		load(id) {
			if (id === `\0${VIRTUAL}`) return `export default ${JSON.stringify(data.icons)};`;
		},
		generateBundle() {
			const css = inlineCssIcons(readFileSync(new URL("./src/report.css", import.meta.url), "utf8"), data.icons);
			if (css.includes('icon("')) this.error("report.css: unresolved icon() reference in the emitted stylesheet");
			this.emitFile({ type: "asset", fileName: "icons.json", source: JSON.stringify(data) });
			this.emitFile({ type: "asset", fileName: "report.css", source: css });
		},
	};
}

export default defineConfig({
	base: "./",
	build: {
		target: "es2022",
		outDir: "dist",
		emptyOutDir: true,
		cssCodeSplit: true,
		assetsInlineLimit: 0,
		modulePreload: { polyfill: false },
		sourcemap: false,
		rollupOptions: {
			input: { runtime: "src/runtime.ts" },
			output: {
				entryFileNames: "runtime.js",
				chunkFileNames: "chunks/[name]-[hash].js",
				assetFileNames: "assets/[name]-[hash][extname]",
				// Keep Vite's preload helper out of the entry: dynamic chunks must
				// not import runtime.js (a second URL copy would boot twice).
				manualChunks(id: string) {
					if (id.includes("vite/preload-helper")) return "preload";
				},
			},
		},
	},
	plugins: [heroicons()],
});
