import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";

const BACKEND = "http://127.0.0.1:8787";
const OWNER = "dev";

function backend(ws = false): ProxyOptions {
	return {
		target: BACKEND,
		ws,
		headers: { "X-Artifacts-Owner": OWNER },
		configure(proxy) {
			proxy.on("proxyReqWs", proxyReq => {
				proxyReq.setHeader("X-Artifacts-Owner", OWNER);
			});
		},
	};
}

/** Dev/preview: serve the share shell for `/s/<token>` like the server does in production. */
function shareShell(): Plugin {
	const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
		if (req.url && /^\/s\/[^/?]+\/?(\?.*)?$/.test(req.url)) req.url = "/share.html";
		next();
	};
	return {
		name: "artifacts-share-shell",
		configureServer(server) {
			server.middlewares.use(rewrite);
		},
		configurePreviewServer(server) {
			server.middlewares.use(rewrite);
		},
	};
}

const proxy: Record<string, ProxyOptions> = {
	"/api": backend(true),
	// The share shell itself is served by Vite (share.html); only its API-ish subpaths go to the backend.
	"^/s/[^/]+/(meta|body|ws)$": backend(true),
	"/c": backend(),
	"/_render": backend(),
};

export default defineConfig({
	plugins: [shareShell(), svelte()],
	server: { port: 5173, strictPort: true, proxy },
	preview: { port: 4173, strictPort: true, proxy },
	appType: "spa",
	build: {
		target: "es2023",
		// Vite 8 defaults CSS minification to Lightning CSS, which lowers `light-dark()` into
		// `--lightningcss-light/dark` toggled only by `prefers-color-scheme`. That breaks runtime
		// theme switching through inline `color-scheme`, so target browsers that support it natively.
		cssTarget: ["chrome123", "firefox120", "safari17.5"],
		rollupOptions: {
			input: {
				index: resolve(import.meta.dirname, "index.html"),
				share: resolve(import.meta.dirname, "share.html"),
			},
		},
	},
});
