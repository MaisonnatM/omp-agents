// Projects: a session in an omp-agents dashboard project, a board channel carrying a goal, gets its brief, the goal,
// plan, decisions, and newest messages, at its first prompt and again whenever the project changed since.
// The dashboard's `board` tool makes every change to a project; this extension only reads `board.json`.
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CONFIG_DIR, readJson } from "./inbox/client";
import { boardIn, briefText } from "./project/brief";

const BOARD_FILE = join(CONFIG_DIR, "board.json");
const BRIEF_TYPE = "omp-agents.project";

export default function project(pi: ExtensionAPI) {
	// The brief this session last got, so a prompt sends it again only once the project changed.
	let briefed: string | null = null;
	pi.on("before_agent_start", (event, ctx) => {
		if (event.reason === "revive" || ctx.agent.kind === "sub" || ctx.mode === "print" || ctx.mode === "json") return;
		const brief = briefText(boardIn(readJson(BOARD_FILE)), ctx.sessionManager.getSessionId());
		if (!brief || brief === briefed) return;
		briefed = brief;
		return { message: { customType: BRIEF_TYPE, content: brief, display: false } };
	});
}
