<script lang="ts">
import Icon from "./Icon.svelte";
import ThemeToggle from "./ThemeToggle.svelte";
</script>

<header class="nav">
	<a class="brand" href="/">
		<span class="dot" aria-hidden="true"></span>
		artifacts
	</a>
	<a class="nav-link" href="/split">
		<Icon name="split" size={15} />
		<span>Split view</span>
	</a>
	<div class="spacer"></div>
	<ThemeToggle />
</header>

<style>
	.nav {
		display: flex;
		align-items: center;
		gap: 16px;
		height: var(--nav-h);
		padding: 0 18px;
		border-bottom: 1px solid var(--border);
		background: var(--bg);
		flex: none;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 700;
		font-size: 15px;
		letter-spacing: -0.02em;
		color: var(--fg);
	}

	.brand:hover {
		text-decoration: none;
		opacity: 0.85;
	}

	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-weak);
	}

	.nav-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
		font-size: 13.5px;
		font-weight: 550;
		padding: 5px 9px;
		border-radius: 8px;
	}

	.nav-link:hover {
		color: var(--fg);
		background: var(--surface);
		text-decoration: none;
	}

	.spacer {
		flex: 1;
	}
</style>
