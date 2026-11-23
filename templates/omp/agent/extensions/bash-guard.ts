// Blocks bash and read calls that AGENTS.md forbids, before they run, with the reason and what to do instead:
// printing a `.env` file or the dashboard token, skipping git hooks, starting a server on a default port, stopping the
// omp-agents dashboard, and force-pushing or deleting main or master, which the user may still allow. `bash-guard/rules.ts`
// holds the rules; a push to the target of a repository that lands through `land` is `land/gate.ts`'s.
import { resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { checkBash, checkRead } from "./bash-guard/rules";

export default function bashGuard(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		let verdict;
		if (event.toolName === "read" && typeof input.path === "string") verdict = checkRead(input.path);
		else if (event.toolName === "bash" && typeof input.command === "string") verdict = checkBash(input.command, typeof input.cwd === "string" ? resolve(ctx.cwd, input.cwd) : ctx.cwd);
		if (!verdict) return;
		if (!verdict.ask) return { block: true, reason: verdict.reason };
		if (ctx.hasUI && (await ctx.ui.confirm("Rewrite main?", verdict.ask))) return;
		return {
			block: true,
			reason: ctx.hasUI
				? `${verdict.reason} The user declined it: ask the user how to proceed.`
				: `${verdict.reason} This session cannot ask for that approval: ask the user to run it, or to approve it in an interactive session.`,
		};
	});
}
