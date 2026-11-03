/** What every omp-agents extension shares: the part of omp's extension API it uses, its flags, and the `remember` tool's Markdown memory. */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText } from "../json";
import { readTail } from "../read-tail";
import { MAX_FACT_LENGTH, MAX_MEMORY_BYTES, REMEMBER_TOOL } from "../shared/bots";

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
	approval: "write";
	/** omp passes every tool the session's context; this reads only its `cwd`, the session's workspace. */
	execute(toolCallId: string, params: Params, signal: AbortSignal | undefined, onUpdate: unknown, ctx: { cwd: string }): Promise<ToolResult>;
}

interface SchemaOptions {
	description?: string;
}

/** The part of omp's `ExtensionAPI` the extensions use, by hand: `tsc` cannot resolve omp's own package here. Each hook's `cwd` is the session's directory as it is now, after any `/move`. */
export interface ExtensionApi {
	registerFlag(name: string, options: { type: "string"; description: string }): void;
	getFlag(name: string): boolean | string | undefined;
	on(event: "session_start", handler: (event: unknown, ctx: { cwd: string }) => void): void;
	on(event: "before_agent_start", handler: (event: { systemPrompt: string[] }, ctx: { cwd: string; agent: { kind: "main" | "sub" } }) => { systemPrompt: string[] } | undefined): void;
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

/** The memory at `path` as a system prompt carries it: its newest facts, after a note when older ones were cut, or `Nothing yet.` */
export function memoryLines(path: string): string[] {
	let memory: { text: string; cut: boolean } | null = null;
	try {
		memory = readTail(path, MAX_MEMORY_BYTES);
	} catch {
		// An unreadable memory leaves this turn without it rather than stopping it.
	}
	return [...(memory?.cut ? ["(Older memory was cut to keep this prompt short; only the newest facts follow.)"] : []), memory?.text.trim() || "Nothing yet."];
}

/**
 * The `remember` tool, the one writer of a Markdown memory: each fact is a dated `- YYYY-MM-DD <fact>` line. `memoryPath`
 * names the file for the session calling it, or throws why it has none.
 */
export function rememberTool(pi: ExtensionApi, description: string, memoryPath: (ctx: { cwd: string }) => string): ExtensionTool<{ fact: string }> {
	return {
		name: REMEMBER_TOOL,
		label: "Remember",
		description,
		parameters: pi.typebox.Type.Object({ fact: pi.typebox.Type.String({ description: "The fact, as one short sentence.", maxLength: MAX_FACT_LENGTH }) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { fact }, _signal, _onUpdate, ctx) {
			const path = memoryPath(ctx);
			const line = fact.replace(/\s+/g, " ").trim();
			if (!line) throw new Error("fact is empty.");
			if (line.length > MAX_FACT_LENGTH) throw new Error(`fact is ${line.length} characters; keep it to one short sentence of at most ${MAX_FACT_LENGTH}.`);
			try {
				mkdirSync(dirname(path), { recursive: true });
				appendFileSync(path, `- ${new Date().toISOString().slice(0, 10)} ${line}\n`);
			} catch (error) {
				throw new Error(`Cannot write the memory: ${errorText(error)}`);
			}
			return reply(`Remembered: ${line}`);
		},
	};
}
