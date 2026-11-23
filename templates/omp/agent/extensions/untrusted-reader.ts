// Keeps text other people wrote away from the agents that act on it. An `untrusted-reader` subagent gets the files its
// assignment names in a message before its first turn, and no tool but `yield`; a session whose bash prints issue, PR,
// comment, or review text through `gh` is told once to read such text through that agent. `untrusted-reader/rules.ts`
// holds both decisions.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { nudge, READER, readerInput, untrustedFetch } from "./untrusted-reader/rules";

export default function untrustedReader(pi: ExtensionAPI) {
	let nudged = false;

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.name === READER) await pi.setActiveTools(pi.getActiveTools().filter(name => name === "yield"));
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.agent.name !== READER || event.reason !== "prompt") return;
		return { message: { customType: "omp-untrusted.input", content: readerInput(event.prompt, ctx.cwd), display: false } };
	});

	// MCP and extension tools can come back after `session_start`, so the reader's calls are checked too.
	pi.on("tool_call", (event, ctx) => {
		if (ctx.agent.name !== READER || event.toolName === "yield") return;
		return { block: true, reason: "The untrusted reader has no tools: report on the text in your prompt with `yield`." };
	});

	pi.on("tool_result", (event, ctx) => {
		if (nudged || ctx.agent.name === READER || event.toolName !== "bash" || event.isError) return;
		const command = event.input.command;
		const fetch = typeof command === "string" ? untrustedFetch(command) : undefined;
		if (!fetch) return;
		nudged = true;
		return { additionalContext: nudge(fetch) };
	});
}
