/**
 * Minimal ambient declarations for the omp host modules this plugin imports.
 *
 * The plugin runs inside omp and imports the host's own modules by package
 * specifier; the host ships source (no `.d.ts`), so this file declares only the
 * surface used here. Signatures mirror:
 * - `packages/coding-agent/src/internal-urls/types.ts`
 * - `packages/coding-agent/src/internal-urls/router.ts`
 * - `packages/coding-agent/src/extensibility/extensions/types.ts`
 * - `packages/coding-agent/src/extensibility/plugins/{loader,manager}.ts`
 */
declare module "@oh-my-pi/pi-coding-agent" {
	export type TextContent = { type: "text"; text: string };
	export type ImageContent = { type: "image"; [key: string]: unknown };
	export type ToolContent = TextContent | ImageContent;

	export interface ToolResult<D = unknown> {
		content: ToolContent[];
		details?: D;
		isError?: boolean;
	}

	export interface ExtensionUIApi {
		input(title: string, placeholder?: string): Promise<string | undefined>;
		notify(message: string, type?: "info" | "warning" | "error"): void;
	}

	export interface ExtensionContext {
		cwd: string;
		mode: "tui" | "rpc" | "json" | "print";
		ui: ExtensionUIApi;
	}

	export type ExtensionCommandContext = ExtensionContext;

	export interface BeforeAgentStartEvent {
		prompt: string;
		images?: ImageContent[];
		systemPrompt: string[];
	}

	export interface BeforeAgentStartEventResult {
		systemPrompt?: string[];
	}

	export interface ToolResultEvent {
		type: "tool_result";
		toolCallId: string;
		toolName: string;
		input: Record<string, unknown>;
		content: ToolContent[];
		isError: boolean;
		details: unknown;
	}

	export interface ToolResultEventResult {
		content?: ToolContent[];
		details?: unknown;
		isError?: boolean;
		additionalContext?: string;
	}

	export interface AutocompleteItem {
		value: string;
		label: string;
		description?: string;
	}

	export interface ToolDefinition<P = unknown, D = unknown> {
		name: string;
		label: string;
		description: string;
		parameters: unknown;
		approval?: "read" | "write" | "exec";
		loadMode?: "essential" | "discoverable";
		execute(
			toolCallId: string,
			params: P,
			signal: AbortSignal | undefined,
			onUpdate: ((update: Partial<ToolResult<D>>) => void) | undefined,
			ctx: ExtensionContext,
		): Promise<ToolResult<D>>;
	}

	export interface RegisteredCommand {
		description?: string;
		getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
		handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	}

	export interface ZodString {
		describe(description: string): ZodString;
		optional(): ZodString;
	}

	export interface ZodApi {
		string(): ZodString;
		object(shape: Record<string, unknown>): unknown;
	}

	export type HostLogger = {
		debug(message: string, context?: Record<string, unknown>): void;
		info(message: string, context?: Record<string, unknown>): void;
		warn(message: string, context?: Record<string, unknown>): void;
		error(message: string, context?: Record<string, unknown>): void;
	};

	export interface ExtensionAPI {
		logger: HostLogger;
		zod: ZodApi;
		setLabel(label: string): void;
		on(
			event: "before_agent_start",
			handler: (
				event: BeforeAgentStartEvent,
				ctx: ExtensionContext,
			) => Promise<BeforeAgentStartEventResult | undefined> | BeforeAgentStartEventResult | undefined,
		): void;
		on(
			event: "tool_result",
			handler: (
				event: ToolResultEvent,
				ctx: ExtensionContext,
			) => Promise<ToolResultEventResult | undefined> | ToolResultEventResult | undefined,
		): void;
		registerTool<P = unknown, D = unknown>(tool: ToolDefinition<P, D>): void;
		registerCommand(name: string, options: RegisteredCommand): void;
	}

	export default ExtensionAPI;
}

declare module "@oh-my-pi/pi-coding-agent/internal-urls" {
	export interface InternalUrl extends URL {
		rawHost: string;
		rawPathname?: string;
		rawHref?: string;
	}

	export interface InternalResource {
		url: string;
		content: string;
		contentType: "text/markdown" | "application/json" | "text/plain";
		size?: number;
		sourcePath?: string;
		notes?: string[];
		immutable?: boolean;
		isDirectory?: boolean;
		shape?: "document" | "value";
		unbounded?: boolean;
	}

	export interface ResolveContext {
		cwd?: string;
		signal?: AbortSignal;
	}

	export interface WriteContext {
		cwd?: string;
		signal?: AbortSignal;
	}

	export interface InternalWriteResult {
		content: Array<{ type: "text"; text: string } | { type: "image"; [key: string]: unknown }>;
		details?: { resolvedPath?: string };
		isError?: boolean;
		useless?: boolean;
	}

	export interface LocateOptions {
		directory?: boolean;
		create?: boolean;
		localOnly?: boolean;
	}

	export interface UrlCompletion {
		value: string;
		label?: string;
		description?: string;
	}

	export interface SchemeWritePolicy {
		via: "file" | "handler";
		fileEdits?: true;
		payload: "text" | "verbatim";
		scope: "workspace" | "sandbox" | "coordination" | "device";
		tier(url: InternalUrl, content: string | undefined, session: unknown): unknown;
		contentOptional?(url: InternalUrl): boolean;
	}

	export interface SchemeSpec {
		backing: "file" | "virtual" | "remote" | "device";
		selectors: "lines" | "none" | "opaque";
		portAuthority?: boolean;
		pathAuthority?: true;
		immutable: boolean;
		linkable?: boolean;
		readTier?: "read" | "write" | "exec";
		unbounded?: boolean;
		singleSlashAlias?: boolean;
		hideFrontmatter?: boolean;
		write?: SchemeWritePolicy;
	}

	export interface ProtocolHandler {
		readonly scheme: string;
		readonly spec: SchemeSpec;
		resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource>;
		write?(url: InternalUrl, content: string, context?: WriteContext): Promise<InternalWriteResult | undefined>;
		complete?(query?: string, context?: ResolveContext): Promise<UrlCompletion[]>;
		locate?(url: InternalUrl, context?: ResolveContext, options?: LocateOptions): Promise<string | null>;
	}

	export class InternalUrlRouter {
		static instance(): InternalUrlRouter;
		register(handler: ProtocolHandler): void;
		unregister(scheme: string): boolean;
		getHandler(scheme: string): ProtocolHandler | undefined;
		isBuiltin(scheme: string): boolean;
	}
}

declare module "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader" {
	/** Plugin settings merged with project overrides, read from the plugin lockfile. */
	export function getPluginSettings(pluginName: string, cwd: string): Promise<Record<string, unknown>>;
}

declare module "@oh-my-pi/pi-coding-agent/extensibility/plugins/manager" {
	export class PluginManager {
		constructor(cwd?: string);
		getPluginSettings(name: string): Promise<Record<string, unknown>>;
		setPluginSetting(name: string, key: string, value: unknown): Promise<void>;
		deletePluginSetting(name: string, key: string): Promise<void>;
	}
}
