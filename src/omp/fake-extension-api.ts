/** A stand-in for omp's extension API, for the Bot extensions' tests. */
import type { BotExtensionApi, BotTool } from "./bot-extension";

type Handler = Parameters<BotExtensionApi["on"]>[1];

/** `extension` loaded as omp loads it with `flags`, its tools called from a session in `cwd`. */
export function loadExtension(extension: (pi: BotExtensionApi) => void, flags: ReadonlyMap<string, string>, cwd = "/work") {
	let handler: Handler | undefined;
	const tools = new Map<string, BotTool<unknown>>();
	const identity = (value: unknown) => value;
	extension({
		registerFlag() {},
		getFlag: name => flags.get(name),
		on: (_event, registered) => void (handler = registered),
		registerTool: registered => void tools.set(registered.name, registered as BotTool<unknown>),
		typebox: { Type: { Object: identity, String: identity, Integer: identity, Boolean: identity, Literal: identity, Union: identity, Array: identity, Optional: identity } },
	});
	return {
		/** The system prompt a turn of a `kind` agent starts with, after the base prompt. */
		prompt: (kind: "main" | "sub" = "main") => handler!({ systemPrompt: ["base"] }, { agent: { kind } })?.systemPrompt,
		call: <Params>(name: string, params: Params) => tools.get(name)!.execute("call-1", params, undefined, undefined, { cwd }),
	};
}
