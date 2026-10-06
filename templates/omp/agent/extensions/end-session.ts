// The `end_session` tool: lets an agent end its own session once its work is done, as the omp-agents dashboard's
// End session does, and remove the git worktree it ran in. The request waits for the turn to finish, so the agent's
// last reply is saved, then goes to the dashboard's end inbox as `<session id>.json`; the dashboard server ends the
// session and removes the worktree through the same checks as its Worktrees tab. A new turn or an exit withdraws it.
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const INBOX_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "end-inbox");

export default function endSession(pi: ExtensionAPI) {
	const z = pi.zod;
	const params = z.object({
		removeWorktree: z.boolean().optional().describe("also remove the git worktree this session runs in; its branch stays"),
	});
	/** What this turn asked for, sent once it ends. */
	let asked: { removeWorktree: boolean } | null = null;
	let sent: string | null = null;
	const withdraw = (): void => {
		if (sent) rmSync(sent, { force: true });
		sent = null;
	};

	pi.registerTool({
		loadMode: "essential",
		name: "end_session",
		label: "End session",
		description: [
			"Ends this session once your reply is done, as the omp-agents dashboard's End session does; set removeWorktree to also remove the git worktree you run in.",
			"Call it last, only when the user asked you to end the session and the work is merged or pushed.",
			"Then give your final reply; it stays in the transcript.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return { content: [{ type: "text", text: "Invalid end_session input." }], isError: true };
			if (ctx.agent.kind === "sub") return { content: [{ type: "text", text: "A subagent's session ends with its task." }], isError: true };
			asked = { removeWorktree: parsed.data.removeWorktree ?? false };
			const worktree = asked.removeWorktree ? " and removes its worktree" : "";
			return { content: [{ type: "text", text: `When this turn ends, the dashboard ends this session${worktree}. Give your final reply now.` }] };
		},
	});

	pi.on("agent_start", () => {
		asked = null;
		withdraw();
	});
	pi.on("agent_end", (_event, ctx) => {
		if (!asked) return;
		const sessionId = ctx.sessionManager.getSessionId();
		mkdirSync(INBOX_DIR, { recursive: true });
		const temp = join(INBOX_DIR, `${sessionId}.tmp`);
		writeFileSync(temp, JSON.stringify({ sessionId, removeWorktree: asked.removeWorktree }));
		sent = join(INBOX_DIR, `${sessionId}.json`);
		renameSync(temp, sent);
		asked = null;
	});
	pi.on("session_shutdown", withdraw);
}
