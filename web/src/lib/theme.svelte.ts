export type ThemePref = "system" | "light" | "dark";
export type Scheme = "light" | "dark";

const STORAGE_KEY = "agent-reports-theme";

function readPref(): ThemePref {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value === "light" || value === "dark" || value === "system") return value;
	} catch {
		// storage may be unavailable (private mode, sandbox) — fall back to system
	}
	return "system";
}

class ThemeStore {
	pref = $state<ThemePref>(readPref());
	#media = window.matchMedia("(prefers-color-scheme: dark)");
	#systemDark = $state(this.#media.matches);

	/** The scheme that is actually rendered, i.e. what sandboxed frames get pushed. */
	scheme = $derived<Scheme>(this.pref === "system" ? (this.#systemDark ? "dark" : "light") : this.pref);

	#next: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

	constructor() {
		this.#apply();
		this.#media.addEventListener("change", event => {
			this.#systemDark = event.matches;
		});
	}

	set(pref: ThemePref): void {
		this.pref = pref;
		this.#apply();
	}

	cycle(): void {
		this.set(this.#next[this.pref]);
	}

	#apply(): void {
		// `light dark` lets the browser follow `prefers-color-scheme` live.
		document.documentElement.style.colorScheme = this.pref === "system" ? "light dark" : this.pref;
		try {
			localStorage.setItem(STORAGE_KEY, this.pref);
		} catch {
			// ignore storage failures
		}
	}
}

export const theme = new ThemeStore();

export const themeLabels: Record<ThemePref, string> = {
	system: "system",
	light: "light",
	dark: "dark",
};

export function nextTheme(pref: ThemePref): ThemePref {
	return pref === "system" ? "light" : pref === "light" ? "dark" : "system";
}
