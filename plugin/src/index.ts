/**
 * artifacts omp plugin.
 *
 * Registers the process-global `report://` scheme (listings, guide, source reads
 * with hashline `edit`, text versions), the `report_upload` tool, and the
 * `/artifacts` command (login / logout / status). A `before_agent_start` hook
 * advertises the report workflow in the system prompt.
 */
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import {
	ApiError,
	COOKIE_NAME,
	checkLogin,
	DEFAULT_URL,
	IDENTITY_RE,
	loginWithBasic,
	MAX_ASSET_BYTES,
	readConfig,
	uploadAsset,
	writeSession,
} from "./api";
import { readUploadParams } from "./guards";
import {
	ArtifactsReportHandler,
	type EditPushOutcome,
	projectFromCwd,
	pushPendingEdits,
	reportUrlToMirror,
} from "./handler";

const ALLOWED_ASSETS: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".csv": "text/csv",
	".json": "application/json",
	".txt": "text/plain",
};

/** Install the `report://` handler into the host's process-global router once. */
function installReportScheme(log: (message: string) => void): void {
	const router = InternalUrlRouter.instance();
	if (router.getHandler("report") instanceof ArtifactsReportHandler) return;
	try {
		router.register(new ArtifactsReportHandler());
	} catch (error) {
		log(`report:// scheme registration failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function expandHome(value: string): string {
	if (value === "~") return os.homedir();
	if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
	return value;
}

/** Files an `edit`/`write` call targeted, whatever shape its arguments took. */
function editedPaths(input: Record<string, unknown>): string[] | undefined {
	const found: string[] = [];
	for (const key of ["path", "file_path", "filePath"] as const) {
		const value = input[key];
		if (typeof value === "string" && value !== "") found.push(value);
	}
	const edits = input.edits;
	if (Array.isArray(edits)) {
		for (const entry of edits) {
			if (!entry || typeof entry !== "object" || !("path" in entry)) continue;
			const value = entry.path;
			if (typeof value === "string" && value !== "") found.push(value);
		}
	}
	const unique = [...new Set(found)];
	return unique.length > 0 ? unique : undefined;
}

function requireIdentity(value: string, label: string): string {
	if (!IDENTITY_RE.test(value)) {
		throw new Error(`${label} "${value}" must match ${IDENTITY_RE.source} (lowercase letters, digits, "_" and "-")`);
	}
	return value;
}

function describeError(error: unknown): string {
	if (error instanceof ApiError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

function systemPromptSection(url: string, project: string, loggedIn: boolean): string {
	const lines = [
		"## artifacts (human-facing reports)",
		`<${url}> holds HTML reports the human reads: publish findings there instead of dumping long output into chat.`,
		`- Create/overwrite: \`write report://<project>/<slug>\` — project is the repo dir name (here \`${project}\`); body = an HTML fragment or GitHub-flavoured Markdown after a \`---\` frontmatter block with \`title\` (and optional \`description\`).`,
		`- Edit in place: hashline \`edit\` on \`report://<project>/<slug>\`. List: \`read report://list\` (\`?project=<name>\`, \`?project=*\`); text version: \`<slug>.md\`; guide: \`read report://guide\`.`,
		'- Assets: `report_upload` with {project, slug, path} uploads a local file and returns the `<img src="assets/…">` markup.',
		"- Rules: lead with the result; state each fact once (no recap, no conclusion); prefer tables/charts/images over prose; no narration, hedging, filler, or footnotes; edit the existing report instead of adding new ones.",
		'- No unicode arrows, check marks, symbols or emoji (→ ✓ ✗ ⚠ ★ ▲ 🚀 …): use `<x-icon name="arrow-right"></x-icon>` (Heroicons names, optional `tone="ok|warn|err|muted|accent"`). The server rejects them.',
	];
	if (!loggedIn) lines.push("- Not logged in: run `/artifacts login` before publishing.");
	return lines.join("\n");
}

export default function artifactsPlugin(pi: ExtensionAPI): void {
	installReportScheme(message => pi.logger.warn(message));

	pi.setLabel("artifacts");

	pi.on("before_agent_start", async (event, ctx) => {
		const cfg = await readConfig(ctx.cwd).catch(() => undefined);
		const section = systemPromptSection(cfg?.url ?? DEFAULT_URL, projectFromCwd(ctx.cwd), cfg?.session !== undefined);
		return { systemPrompt: [...event.systemPrompt, section] };
	});

	// `edit` patches a local mirror of the report; push the change back to the server.
	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) return;
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const inputs = editedPaths(event.input);
		if (inputs === undefined) return;
		// A hashline `edit` on `report://p/s` patches that report's mirror file, so
		// the URL maps to the mirror before matching. A `write` to the same URL is
		// already sent by the handler and its mirror matches the server, so it
		// finds nothing to push.
		const edited = [...new Set(inputs.map(file => reportUrlToMirror(file) ?? file))];
		let outcome: EditPushOutcome;
		try {
			outcome = await pushPendingEdits(ctx.cwd, edited);
		} catch (error) {
			return {
				isError: true,
				content: [...event.content, { type: "text", text: `Not saved to artifacts: ${describeError(error)}` }],
			};
		}
		if (outcome.failed !== undefined) {
			return {
				isError: true,
				content: [
					...event.content,
					{
						type: "text",
						text: `Not saved to artifacts: ${outcome.failed.url} — ${outcome.failed.error.message}`,
					},
				],
			};
		}
		if (outcome.saved.length === 0) return;
		const notes = outcome.saved.map(item => `Saved ${item.url} rev ${item.rev} — ${item.publicUrl}`);
		return { content: [...event.content, { type: "text", text: notes.join("\n") }] };
	});

	pi.registerTool({
		name: "report_upload",
		label: "Upload report asset",
		description:
			'Upload a local file (image, csv, json, or txt) as an asset of an artifacts report. Returns the markup to embed: `<img src="assets/<name>">` for images, `assets/<name>` as a `data.url` for csv/json.',
		parameters: pi.zod.object({
			project: pi.zod.string().describe("report project, e.g. the repo dir name"),
			slug: pi.zod.string().describe("report slug the asset belongs to (the report need not exist yet)"),
			path: pi.zod.string().describe("local file path (relative to the working directory or absolute)"),
			name: pi.zod.string().optional().describe("asset name; defaults to the file's basename"),
		}),
		approval: "write",
		loadMode: "essential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const input = readUploadParams(params);
			const project = requireIdentity(input.project.toLowerCase(), "project");
			const slug = requireIdentity(input.slug, "slug");
			const localPath = path.resolve(ctx.cwd, expandHome(input.path));
			const name = (input.name ?? path.basename(localPath)).replace(/[^A-Za-z0-9._-]/g, "-");
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
				throw new Error(`asset name "${name}" must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`);
			}
			const contentType = ALLOWED_ASSETS[path.extname(localPath).toLowerCase()];
			if (contentType === undefined) {
				throw new Error(
					`cannot infer an allowed content type for ${path.basename(localPath)} (supported: ${Object.keys(ALLOWED_ASSETS).join(", ")})`,
				);
			}
			const file = Bun.file(localPath);
			const size = file.size;
			if (size === 0 && !(await file.exists())) throw new Error(`no such file: ${localPath}`);
			if (size > MAX_ASSET_BYTES) {
				throw new Error(`${localPath} is ${size} bytes; the asset limit is ${MAX_ASSET_BYTES / 1048576} MiB`);
			}
			const cfg = await readConfig(ctx.cwd);
			const asset = await uploadAsset(cfg, project, slug, name, contentType, await file.bytes(), signal);
			const src = asset.src === "" ? `assets/${asset.name}` : asset.src;
			const snippet = contentType.startsWith("image/") ? `<img src="${src}" alt="${name}">` : src;
			const hint = contentType.startsWith("image/")
				? `Embed it with ${snippet}`
				: `Reference it as data.url: "${src}" (e.g. in an <x-chart> spec)`;
			return {
				content: [
					{
						type: "text",
						text: `Uploaded ${src} (${contentType}, ${asset.size} bytes) to report://${project}/${slug}.\n${hint}`,
					},
				],
				details: { src, name: asset.name, contentType, size: asset.size },
			};
		},
	});

	pi.registerCommand("artifacts", {
		description: "artifacts: login (Basic auth, stores the remember cookie), logout, status",
		getArgumentCompletions: prefix =>
			["login", "logout", "status"]
				.filter(value => value.startsWith(prefix))
				.map(value => ({ value, label: value })),
		handler: async (args, ctx) => {
			const [subcommand] = args.trim().split(/\s+/);
			switch (subcommand ?? "status") {
				case "login":
					await runLogin(pi, ctx);
					return;
				case "logout":
					await writeSession(ctx.cwd, undefined);
					ctx.ui.notify("artifacts: logged out (session cleared)", "info");
					return;
				case "status":
					await runStatus(ctx);
					return;
				default:
					ctx.ui.notify(`artifacts: unknown subcommand "${subcommand}" — use login, logout, or status`, "warning");
			}
		},
	});
}

async function runLogin(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const cfg = await readConfig(ctx.cwd);
	ctx.ui.notify(`artifacts: logging in to ${cfg.url}`, "info");
	const username = await ctx.ui.input("Artifacts username", "user");
	if (username === undefined) {
		ctx.ui.notify("artifacts: login cancelled", "info");
		return;
	}
	const password = await ctx.ui.input("Artifacts password");
	if (password === undefined || password === "") {
		ctx.ui.notify("artifacts: login cancelled", "info");
		return;
	}
	const result = await loginWithBasic(cfg, username.trim() || "user", password);
	if (!result.ok) {
		ctx.ui.notify(`artifacts: login failed (HTTP ${result.status}) — check the username and password`, "error");
		return;
	}
	if (result.cookie === undefined) {
		ctx.ui.notify(
			`artifacts: authenticated, but the server sent no ${COOKIE_NAME} cookie — check the Traefik remember-cookie config`,
			"error",
		);
		return;
	}
	await writeSession(ctx.cwd, result.cookie);
	const stored = await readConfig(ctx.cwd);
	const verified = await checkLogin(stored).catch(() => false);
	pi.logger.info("artifacts: session cookie stored");
	ctx.ui.notify(
		verified
			? `artifacts: logged in to ${stored.url} (session stored)`
			: `artifacts: session stored for ${stored.url}, but /api/me rejected it — run /artifacts login again`,
		verified ? "info" : "warning",
	);
}

async function runStatus(ctx: ExtensionContext): Promise<void> {
	const cfg = await readConfig(ctx.cwd);
	const lines = [`url: ${cfg.url}`, `project: ${projectFromCwd(ctx.cwd)}`];
	if (cfg.session === undefined) {
		lines.push("not logged in — run /artifacts login");
	} else {
		const ok = await checkLogin(cfg).catch(error => {
			lines.push(`error: ${describeError(error)}`);
			return false;
		});
		if (ok) lines.push("logged in (session cookie accepted)");
		else if (lines.length === 2) lines.push("session cookie rejected — run /artifacts login");
	}
	ctx.ui.notify(`artifacts:\n${lines.join("\n")}`, "info");
}
