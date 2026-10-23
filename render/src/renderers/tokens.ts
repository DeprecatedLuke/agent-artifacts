import type { Theme } from "./types";

/** The report colour tokens, resolved to concrete colours for the current theme. */
export interface ThemeTokens {
	bg: string;
	surface: string;
	fg: string;
	muted: string;
	border: string;
	accent: string;
	ok: string;
	warn: string;
	err: string;
}

const cache = new Map<Theme, ThemeTokens>();

/**
 * Chart and diagram libraries need literal colours, but report.css only has
 * `light-dark()` custom properties. A hidden probe inherits them and lets the
 * browser compute the used value, so both stay driven by the same tokens.
 */
export function themeTokens(theme: Theme): ThemeTokens {
	const cached = cache.get(theme);
	if (cached) return cached;
	const probe = document.createElement("span");
	probe.hidden = true;
	document.body.append(probe);
	const read = (name: string) => {
		probe.style.color = `var(${name})`;
		return getComputedStyle(probe).color;
	};
	const tokens: ThemeTokens = {
		bg: read("--bg"),
		surface: read("--surface"),
		fg: read("--fg"),
		muted: read("--muted"),
		border: read("--border"),
		accent: read("--accent"),
		ok: read("--ok"),
		warn: read("--warn"),
		err: read("--err"),
	};
	probe.remove();
	cache.set(theme, tokens);
	return tokens;
}
