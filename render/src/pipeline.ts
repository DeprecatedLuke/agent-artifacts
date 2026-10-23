import { specs } from "./renderers";
import type { RenderContext, RendererModule, RendererSpec } from "./renderers/types";

const loaded = new Map<string, RendererModule>();

function detected(spec: RendererSpec, root: ParentNode): boolean {
	try {
		return spec.detect(root);
	} catch (err) {
		console.error(`[artifacts] detect failed for ${spec.name}`, err);
		return false;
	}
}

async function moduleFor(spec: RendererSpec): Promise<RendererModule> {
	let mod = loaded.get(spec.name);
	if (!mod) {
		mod = await spec.load();
		loaded.set(spec.name, mod);
	}
	return mod;
}

/** Render every component whose markup is present. Loads libraries on demand. */
export async function renderAll(root: ParentNode, theme: RenderContext["theme"]): Promise<void> {
	const active = specs.filter(spec => detected(spec, root));
	await Promise.all(
		active.map(async spec => {
			try {
				const mod = await moduleFor(spec);
				await mod.render(root, { theme });
			} catch (err) {
				console.error(`[artifacts] ${spec.name} render failed`, err);
			}
		}),
	);
}

/** Undo every rendering so the DOM matches the authored fragment again. */
export function resetAll(root: ParentNode): void {
	for (const mod of loaded.values()) {
		try {
			mod.reset?.(root);
		} catch (err) {
			console.error("[artifacts] reset failed", err);
		}
	}
}

/** Re-render the theme-dependent parts after a theme switch. */
export async function themeAll(root: ParentNode, theme: RenderContext["theme"]): Promise<void> {
	await Promise.all(
		[...loaded.values()].map(async mod => {
			if (!mod.theme) return;
			try {
				await mod.theme(root, { theme });
			} catch (err) {
				console.error("[artifacts] theme re-render failed", err);
			}
		}),
	);
}
