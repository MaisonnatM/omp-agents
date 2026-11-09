/** A stand-in for omp's extension API, for the omp-agents extensions' tests. */
import type { ExtensionApi, ExtensionTool, PromptChange } from "./extension-kit";

type PromptHandler = (event: { systemPrompt: string[] }, ctx: { cwd: string; agent: { kind: "main" | "sub" } }) => PromptChange | undefined | Promise<PromptChange | undefined>;
type StartHandler = (event: unknown, ctx: { cwd: string }) => void | Promise<void>;

/** `extension` loaded as omp loads it with `flags`, its hooks run and its tools called from session `sessionId` in `cwd`. */
export function loadExtension(extension: (pi: ExtensionApi) => void, flags: ReadonlyMap<string, string>, cwd = "/work", sessionId = "session-1") {
	const handlers = new Map<string, unknown>();
	const tools = new Map<string, ExtensionTool<unknown>>();
	const identity = (value: unknown) => value;
	extension({
		registerFlag() {},
		getFlag: name => flags.get(name),
		on: (event: string, registered: unknown) => void handlers.set(event, registered),
		registerTool: registered => void tools.set(registered.name, registered as ExtensionTool<unknown>),
		typebox: { Type: { Object: identity, String: identity, Integer: identity, Boolean: identity, Literal: identity, Union: identity, Array: identity, Optional: identity, Unknown: identity } },
	});
	return {
		/** Fires `session_start`, as omp does once the session is ready, from a session in `at`. */
		start: async (at = cwd): Promise<void> => (handlers.get("session_start") as StartHandler | undefined)?.({}, { cwd: at }),
		/** The system prompt a turn of a `kind` agent in `at` starts with, after the base prompt. */
		prompt: async (kind: "main" | "sub" = "main", at = cwd): Promise<string[] | undefined> =>
			(await (handlers.get("before_agent_start") as PromptHandler)({ systemPrompt: ["base"] }, { cwd: at, agent: { kind } }))?.systemPrompt,
		/** The tools the extension registered so far, by name. */
		tools: () => [...tools.keys()],
		call: <Params>(name: string, params: Params, at = cwd) => tools.get(name)!.execute("call-1", params, undefined, undefined, { cwd: at, sessionManager: { getSessionId: () => sessionId } }),
		/** The approval tier omp asks for before it runs tool `name` with `params`. */
		approval: (name: string, params: unknown) => {
			const { approval } = tools.get(name)!;
			return typeof approval === "function" ? approval(params) : approval;
		},
	};
}
