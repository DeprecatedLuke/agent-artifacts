/**
 * Report enhancements that every report gets, so they are statically imported
 * into runtime.js instead of being lazy renderer chunks (see renderers/index.ts
 * for the components that do load on demand).
 *
 * Lifecycle: after `renderAll` (Mermaid figures and tablesort must already be in
 * the DOM), and un-doable, so a live update morphs the authored markup onto the
 * authored markup instead of reconciling generated wrappers.
 */

import { reportBody } from "./dom";
import { enhanceTables, unenhanceTables } from "./tables";
import { enhanceToc, unenhanceToc } from "./toc";
import { enhanceViewer, unenhanceViewer } from "./viewer";

export function enhanceAll(): void {
	const body = reportBody();
	if (!body) return;
	// The sidebar reserves its gutter on <body>; the table layout measures after
	// that through its ResizeObserver, so the order here is not load-bearing.
	enhanceViewer(body);
	enhanceTables(body);
	enhanceToc(body);
}

export function unenhanceAll(): void {
	// The viewer goes first: it holds a table that has to return to its wrapper
	// before the wrappers are unwrapped.
	unenhanceViewer();
	const body = reportBody();
	if (!body) return;
	unenhanceTables(body);
	unenhanceToc(body);
}
