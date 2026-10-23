<script lang="ts" module>
import arrowLeft from "heroicons/24/outline/arrow-left.svg?raw";
import arrowPath from "heroicons/24/outline/arrow-path.svg?raw";
import arrowTopRight from "heroicons/24/outline/arrow-top-right-on-square.svg?raw";
import arrowUpOnSquare from "heroicons/24/outline/arrow-up-on-square.svg?raw";
import check from "heroicons/24/outline/check.svg?raw";
import chevronDown from "heroicons/24/outline/chevron-down.svg?raw";
import computerDesktop from "heroicons/24/outline/computer-desktop.svg?raw";
import documentDuplicate from "heroicons/24/outline/document-duplicate.svg?raw";
import link from "heroicons/24/outline/link.svg?raw";
import magnifyingGlass from "heroicons/24/outline/magnifying-glass.svg?raw";
import moon from "heroicons/24/outline/moon.svg?raw";
import plus from "heroicons/24/outline/plus.svg?raw";
import sun from "heroicons/24/outline/sun.svg?raw";
import trash from "heroicons/24/outline/trash.svg?raw";
import viewColumns from "heroicons/24/outline/view-columns.svg?raw";
import xMark from "heroicons/24/outline/x-mark.svg?raw";

/** App icon name → Heroicons 24/outline source (bundled as raw strings at build time). */
const icons = {
	split: viewColumns,
	copy: documentDuplicate,
	share: arrowUpOnSquare,
	external: arrowTopRight,
	close: xMark,
	plus,
	search: magnifyingGlass,
	monitor: computerDesktop,
	sun,
	moon,
	trash,
	refresh: arrowPath,
	"arrow-left": arrowLeft,
	link,
	"chevron-down": chevronDown,
	check,
} as const;

export type IconName = keyof typeof icons;

/** Heroicons carry no width/height; bake the requested size into the markup once per icon. */
const sized = new Map<string, string>();
function markup(name: IconName, size: number): string {
	const key = `${name}:${size}`;
	let html = sized.get(key);
	if (html === undefined) {
		html = icons[name].replace("<svg ", `<svg width="${size}" height="${size}" focusable="false" `);
		sized.set(key, html);
	}
	return html;
}
</script>

<script lang="ts">
let { name, size = 16 }: { name: IconName; size?: number } = $props();
const html = $derived(markup(name, size));
</script>

<!-- Static Heroicons markup imported at build time, never user input. -->
{@html html}
