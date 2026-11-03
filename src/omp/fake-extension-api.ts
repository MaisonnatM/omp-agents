/** A stand-in for omp's extension API, for the omp-agents extensions' tests. */
import type { ExtensionApi, ExtensionTool } from "./extension-kit";

type PromptHandler = (event: { systemPrompt: string[] }, ctx: { cwd: string; agent: { kind: "main" | "sub" } }) => { systemPrompt: string[] } | undefined;
type StartHandler = (event: unknown, ctx: { cwd: string }) => void;

/** `extension` loaded as omp loads it with `flags`, its hooks run and its tools called from a session in `cwd`. */
export function loadExtension(extension: (pi: ExtensionApi) => void, flags: ReadonlyMap<string, string>, cwd = "/work") {
	const handlers = new Map<string, unknown>();
	const tools = new Map<string, ExtensionTool<unknown>>();
	const identity = (value: unknown) => value;
	extension({
		registerFlag() {},
		getFlag: name => flags.get(name),
		on: (event: string, registered: unknown) => void handlers.set(event, registered),
		registerTool: registered => void tools.set(registered.name, registered as ExtensionTool<unknown>),
		typebox: { Type: { Object: identity, String: identity, Integer: identity, Boolean: identity, Literal: identity, Union: identity, Array: identity, Optional: identity } },
	});
	return {
		/** Fires `session_start`, as omp does once the session is ready, from a session in `at`. */
		start: (at = cwd) => (handlers.get("session_start") as StartHandler | undefined)?.({}, { cwd: at }),
		/** The system prompt a turn of a `kind` agent in `at` starts with, after the base prompt. */
		prompt: (kind: "main" | "sub" = "main", at = cwd) => (handlers.get("before_agent_start") as PromptHandler)({ systemPrompt: ["base"] }, { cwd: at, agent: { kind } })?.systemPrompt,
		/** The tools the extension registered so far, by name. */
		tools: () => [...tools.keys()],
		call: <Params>(name: string, params: Params, at = cwd) => tools.get(name)!.execute("call-1", params, undefined, undefined, { cwd: at }),
	};
}
