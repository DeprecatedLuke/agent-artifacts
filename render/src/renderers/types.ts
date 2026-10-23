export type Theme = "light" | "dark";

export interface RenderContext {
	theme: Theme;
}

/**
 * A lazily loaded renderer. The module is only imported when its markup shows up
 * in the document (see RendererSpec.detect), so a plain report never pays for
 * mermaid, vega, shiki or diff2html.
 */
export interface RendererModule {
	render(root: ParentNode, ctx: RenderContext): void | Promise<void>;
	/** Restore the authored markup so an update can morph raw HTML onto raw HTML. */
	reset?(root: ParentNode): void;
	/** Re-render for a theme switch (only for renderers whose output embeds the theme). */
	theme?(root: ParentNode, ctx: RenderContext): void | Promise<void>;
}

export interface RendererSpec {
	name: string;
	detect(root: ParentNode): boolean;
	load(): Promise<RendererModule>;
}
