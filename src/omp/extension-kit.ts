/** What every omp-agents extension shares: the part of omp's extension API it uses and its flags. */
import { readFileSync } from "node:fs";

interface ToolResult {
	content: { type: "text"; text: string }[];
	details: undefined;
}

export interface ExtensionTool<Params> {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	loadMode: "essential";
	/** omp's approval tier, `read` for a call with no side effect and `write` for one that changes something, or the one a call's arguments ask for. */
	approval: "read" | "write" | ((args: unknown) => "read" | "write");
	/** omp passes every tool the session's context; this reads only its `cwd`, the session's workspace, and its session id. */
	execute(toolCallId: string, params: Params, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
	cwd: string;
	sessionManager: { getSessionId(): string };
}

interface SchemaOptions {
	description?: string;
}

/**
 * What a `before_agent_start` hook hands back: the system prompt the turn starts with, and a message omp adds to the
 * conversation before the turn's prompt, which `display: false` keeps out of the user's view.
 */
export interface PromptChange {
	systemPrompt?: string[];
	message?: { customType: string; content: string; display: boolean };
}

/**
 * The part of omp's `ExtensionAPI` the extensions use, by hand: `tsc` cannot resolve omp's own package here. Each hook's `cwd`
 * is the session's directory as it is now, after any `/move`. omp awaits every `session_start` and `before_agent_start`
 * handler, each for up to 30 seconds, before the session or the turn goes on, and awaits a tool's `execute` before the turn
 * reads its result (`ExtensionRunner.emit` and `emitBeforeAgentStart` in its `extensibility/extensions/runner.ts`, and
 * `ExtensionToolWrapper` in `wrapper.ts`), so a hook may wait on git or a file.
 */
export interface ExtensionApi {
	registerFlag(name: string, options: { type: "string"; description: string }): void;
	getFlag(name: string): boolean | string | undefined;
	on(event: "session_start", handler: (event: unknown, ctx: { cwd: string }) => void | Promise<void>): void;
	on(
		event: "before_agent_start",
		handler: (event: { systemPrompt: string[] }, ctx: { cwd: string; agent: { kind: "main" | "sub" } }) => PromptChange | undefined | Promise<PromptChange | undefined>,
	): void;
	/** omp fires it once compaction replaced the conversation with its summary, so a message sent before it is gone. */
	on(event: "session_compact", handler: () => void): void;
	registerTool<Params>(tool: ExtensionTool<Params>): void;
	/** omptype's TypeBox shim, `@oh-my-pi/omptype/typebox`. */
	typebox: {
		Type: {
			Object(properties: Record<string, unknown>, options?: SchemaOptions): unknown;
			String(options: SchemaOptions & { minLength?: number; maxLength?: number }): unknown;
			Integer(options: SchemaOptions & { minimum?: number; maximum?: number }): unknown;
			Boolean(options: SchemaOptions): unknown;
			Literal(value: string): unknown;
			Union(schemas: unknown[], options?: SchemaOptions): unknown;
			Array(items: unknown, options: SchemaOptions & { minItems?: number; uniqueItems?: boolean }): unknown;
			Optional(schema: unknown): unknown;
			Unknown(options: SchemaOptions): unknown;
		};
	};
}

/**
 * Flag `name`'s value, or `null` when the dashboard passed none. omp sets an extension's flags once every extension has
 * loaded, so each is read when it is used, and it gives one only to an extension that registered it.
 */
export function flagValue(pi: ExtensionApi, name: string): string | null {
	const value = pi.getFlag(name);
	return typeof value === "string" && value !== "" ? value : null;
}

/** The text of the file at `path`, empty when it cannot be read. */
export function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export const reply = (text: string): ToolResult => ({ content: [{ type: "text", text }], details: undefined });
