<script lang="ts">
import { nextTheme, theme, themeLabels } from "../lib/theme.svelte";
import Icon from "./Icon.svelte";

const upcoming = $derived(themeLabels[nextTheme(theme.pref)]);
const icon = $derived(theme.pref === "system" ? "monitor" : theme.pref === "light" ? "sun" : "moon");
</script>

<button
	type="button"
	class="icon-btn"
	aria-label={`Theme: ${themeLabels[theme.pref]}. Switch to ${upcoming} theme`}
	title={`Theme: ${themeLabels[theme.pref]}`}
	onclick={() => theme.cycle()}
>
	<Icon name={icon} size={17} />
</button>
