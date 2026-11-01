// The `land` tool, and the gate that makes it the only way an agent reaches the target branch of a repository that
// commits `.omp/land.json`. `land/lander.ts` does the landing; `land/gate.ts` blocks a bash `git push` to the target,
// a `git merge` into a checked-out target, and `gh pr merge`, so the checks always run on the merged result first.
import { resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { bypass } from "./land/gate";
import { CONFIG_FILE, describe, land } from "./land/lander";
import { located } from "./shell/commands";

export default function landTool(pi: ExtensionAPI) {
	const z = pi.zod;
	const params = z.object({
		divergence: z.string().describe("How the result differs from what was asked: new agreements, another approach, changed scope. Write None when it matches."),
	});

	pi.registerTool({
		loadMode: "essential",
		name: "land",
		label: "Land",
		description: [
			`Lands the branch checked out in this session's directory on the target branch of a repository that commits ${CONFIG_FILE}: merges its committed tip into a fresh worktree of the remote target, runs the checks the file lists on the merged result, and pushes the merge commit, never forced.`,
			"It is the only way to land there; pushing or merging into the target yourself is blocked.",
			"Commit everything first. A conflict or a failed check comes back with the files or the output: fix it on your branch, commit, and land again.",
			"It can take minutes, as long as the checks run.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, signal, onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return { content: [{ type: "text", text: "Invalid land input: give a divergence string." }], isError: true };
			if (ctx.agent.kind === "sub") return { content: [{ type: "text", text: "A subagent commits and reports; the session that started it lands." }], isError: true };
			const steps: string[] = [];
			const result = await land({
				cwd: ctx.cwd,
				divergence: parsed.data.divergence,
				sessionId: ctx.sessionManager.getSessionId(),
				signal,
				progress: step => {
					steps.push(step);
					onUpdate?.({ content: [{ type: "text", text: steps.join("\n") }] });
				},
			});
			return { content: [{ type: "text", text: describe(result) }], details: { result, steps }, isError: result.kind !== "landed" && result.kind !== "nothing" };
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const input = event.input as Record<string, unknown>;
		if (typeof input.command !== "string") return;
		for (const { words, dir } of located(input.command, typeof input.cwd === "string" ? resolve(ctx.cwd, input.cwd) : ctx.cwd)) {
			const reason = bypass(words, dir);
			if (reason) return { block: true, reason };
		}
	});
}
