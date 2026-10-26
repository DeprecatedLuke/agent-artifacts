<script lang="ts">
import ListPage from "./components/ListPage.svelte";
import Nav from "./components/Nav.svelte";
import NotFoundPage from "./components/NotFoundPage.svelte";
import ReportPage from "./components/ReportPage.svelte";
import SplitPage from "./components/SplitPage.svelte";
import { router } from "./lib/router.svelte";
import { appSocket } from "./lib/ws.svelte";

const route = $derived(router.route);

// Report and share views set their own `project: title` document title.
$effect(() => {
	if (route.name !== "report") document.title = "agent-reports";
});

appSocket.connect();
</script>

<div class="app">
	<Nav />
	<main class="main">
		{#if route.name === "list"}
			<ListPage />
		{:else if route.name === "report"}
			{#key `${route.project}/${route.slug}`}
				<ReportPage project={route.project} slug={route.slug} />
			{/key}
		{:else if route.name === "split"}
			<SplitPage panes={route.panes} />
		{:else}
			<NotFoundPage path={route.path} />
		{/if}
	</main>
</div>
