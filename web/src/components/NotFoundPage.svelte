<script lang="ts">
import Icon from "./Icon.svelte";

let { path }: { path: string } = $props();
</script>

<div class="notfound">
	<h1>Page not found</h1>
	<p><span class="mono">{path}</span> is not a route in this app.</p>
	<a class="btn" href="/"><Icon name="arrow-left" size={14} /> All reports</a>
</div>

<style>
	.notfound {
		max-width: 520px;
		margin: 90px auto;
		padding: 26px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
		text-align: center;
	}

	.notfound h1 {
		font-size: 18px;
		margin-bottom: 8px;
	}

	.notfound p {
		color: var(--muted);
		font-size: 13.5px;
		margin: 0 0 16px;
	}
</style>
