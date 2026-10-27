import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { GitHubAccess, quotaReset } from "./github/access";
import { GH, type Gh, ghJson } from "./github/command";
import { descriptionSnapshot, editDescription } from "./github/description";
import { commands } from "./shell/commands";

/** Direct shell writes bypass the checked read, backup and concurrent-change guard. */
export function descriptionWriteCommand(words: string[]): boolean {
	if (words[0] !== "gh") return false;
	if (words[1] === "pr" && words[2] === "edit") return words.some(word => /^(?:--body(?:-file)?(?:=|$)|-[bF])/.test(word));
	if (words[1] !== "api") return false;
	const pull = words.some(word => /(?:^|\/)repos\/[^/]+\/[^/]+\/pulls\/\d+(?:\?|$)/.test(word));
	const body = words.some(word => /^(?:body=|--(?:raw-)?field=body=|-[fF]body=|--input(?:=|$))/.test(word));
	return pull && body;
}

export default function prDescription(pi: ExtensionAPI) {
	const z = pi.zod;
	const access = new GitHubAccess();
	const parameters = z.object({
		repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).describe("GitHub owner/repository"),
		pr: z.number().int().positive(),
		change: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("read") }),
			z.object({ kind: z.literal("append"), text: z.string() }),
			z.object({ kind: z.literal("replace-text"), oldText: z.string(), newText: z.string() }),
			z.object({ kind: z.literal("replace"), original: z.string(), body: z.string(), allowEmpty: z.boolean().optional() }),
		]),
	});
	pi.registerTool({
		name: "pr_description",
		label: "PR description",
		loadMode: "essential",
		description: "Read or safely edit a GitHub PR description. Edits check successful fresh reads, preserve the original privately, reject missing/ambiguous replacement anchors and accidental empty output, and recheck for concurrent changes before writing. Use append or replace-text for surgical edits; a full replace requires the original body from read. Quota exhaustion is not an authentication failure and is not retried.",
		parameters,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const parsed = parameters.safeParse(params);
			if (!parsed.success) return { content: [{ type: "text", text: "Invalid PR description input." }], isError: true };
			const { repo, pr, change } = parsed.data;
			const path = `repos/${repo}/pulls/${pr}`;
			const gh: Gh = args => pi.exec(GH, args, { cwd: ctx.cwd, timeout: 20_000 });
			const reset = async () => quotaReset(await ghJson(gh, ["api", "rate_limit"]), "rest");
			const read = async () => descriptionSnapshot(await access.request("rest", () => ghJson(gh, ["api", path]), reset));
			try {
				if (change.kind === "read") {
					const snapshot = await read();
					return { content: [{ type: "text", text: JSON.stringify(snapshot) }], details: snapshot };
				}
				const result = await editDescription(`${repo}-${pr}`, change, {
					read,
					write: async body => {
						await access.request("rest", () => ghJson(gh, ["api", "-X", "PATCH", path, "-f", `body=${body}`]), reset);
					},
				});
				return { content: [{ type: "text", text: `${result.changed ? "Updated" : "Unchanged"} PR #${pr}. Original description preserved at ${result.originalFile}.` }], details: result };
			} catch (error) {
				return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
			}
		},
	});
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash" || typeof event.input.command !== "string") return;
		if (commands(event.input.command).some(descriptionWriteCommand)) return {
			block: true,
			reason: "Use pr_description for PR body edits. It checks the read succeeded, preserves the original, and refuses unintended empty output or concurrent changes; unchecked gh body writes can erase a PR description when quota is exhausted.",
		};
	});
}
