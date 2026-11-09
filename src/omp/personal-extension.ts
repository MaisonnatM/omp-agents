// omp-agents personal sessions: a session in the Personal space, the dashboard's personal directory or a workspace
// Settings › Workspaces placed there, gets what it remembers about the user on every turn and the `remember` tool, the
// one writer of that memory, and, when the dashboard names the Sport module's files, the `sport` tool and today's
// training on every turn; in the personal directory itself it turns from a coding agent into the user's personal
// assistant. The dashboard loads it with `omp -e` and the flags in `PERSONAL_FLAGS` into every session it starts that is
// not a Bot's (`personalJoin` in src/server/personal.ts); it reads the space each turn, so a session that moves in or
// out, or whose workspace changes space, follows.
import { worktreeAt } from "../git";
import { readWorkspaces } from "../server/workspaces-file";
import { MAX_FACT_LENGTH } from "../shared/bots";
import { localDay } from "../shared/days";
import { spaceOf } from "../shared/workspaces";
import { WorkspacePlacement } from "../workspace-placement";
import { type ExtensionApi, flagValue, memoryLines, rememberTool } from "./extension-kit";
import { readSport, type SportPaths, sportTool, todayLine } from "./sport-tool";

/**
 * The flags a dashboard session starts with: the personal directory, the workspaces file that places workspaces in the
 * Personal space, the Markdown memory every personal session shares, and the Sport module's file and inbox.
 */
export const PERSONAL_FLAGS = {
	dir: "omp-agents-personal-dir",
	workspaces: "omp-agents-workspaces",
	memory: "omp-agents-personal-memory",
	sport: "omp-agents-sport-file",
	sportInbox: "omp-agents-sport-inbox",
} as const;

const ASSISTANT =
	"You are the user's personal assistant, not a coding agent on a project. You help with everyday life such as meals and recipes, shopping, plans, habits and family logistics. Keep any file you make in this directory.";
const PROJECT = "This project is in the user's Personal space: part of their own life, not their job.";
const MEMORY =
	"What you know about the user follows; a later fact overrides an earlier one. When the user tells you something about themselves worth keeping, such as a preference, an allergy, or a household fact, call `remember` with one short sentence. Never remember secrets such as passwords or card numbers.";

/** What a personal session reads and writes: the memory, and the Sport module's paths when the dashboard named them; `assistant` in the personal directory itself. */
interface Personal {
	memory: string;
	sport: SportPaths | null;
	assistant: boolean;
}

export default function personalExtension(pi: ExtensionApi): void {
	pi.registerFlag(PERSONAL_FLAGS.dir, { type: "string", description: "The omp-agents personal directory." });
	pi.registerFlag(PERSONAL_FLAGS.workspaces, { type: "string", description: "The omp-agents workspaces file, which places workspaces in the Personal space." });
	pi.registerFlag(PERSONAL_FLAGS.memory, { type: "string", description: "The Markdown memory personal sessions remember in." });
	pi.registerFlag(PERSONAL_FLAGS.sport, { type: "string", description: "The omp-agents Sport module's file, which personal sessions read." });
	pi.registerFlag(PERSONAL_FLAGS.sportInbox, { type: "string", description: "The directory personal sessions leave their Sport changes in for the dashboard." });

	const placement = new WorkspacePlacement();

	/**
	 * What a session in `cwd` reads and writes as a personal session; `null` when `cwd` is in the Work space or the dashboard
	 * named no memory. The workspaces file is read each time, so a workspace Settings › Workspaces moves follows.
	 */
	const personalIn = async (cwd: string): Promise<Personal | null> => {
		const memory = flagValue(pi, PERSONAL_FLAGS.memory);
		const dir = flagValue(pi, PERSONAL_FLAGS.dir);
		if (memory === null || dir === null) return null;
		const workspaces = flagValue(pi, PERSONAL_FLAGS.workspaces);
		const personal = (workspaces !== null ? readWorkspaces(workspaces)?.personal : undefined) ?? [];
		// Git is asked which workspace `cwd` counts in only while some workspace is Personal, and once per directory.
		if (cwd !== dir && personal.length > 0) await placement.place([cwd], worktreeAt);
		if (spaceOf({ cwd, workspace: placement.cwdOf(cwd) }, personal, dir) === "work") return null;
		const file = flagValue(pi, PERSONAL_FLAGS.sport);
		const inbox = flagValue(pi, PERSONAL_FLAGS.sportInbox);
		return { memory, sport: file !== null && inbox !== null ? { file, inbox } : null, assistant: cwd === dir };
	};

	const notPersonal = (what: string): never => {
		throw new Error(`This session is not in the Personal space, so it has no ${what}.`);
	};

	// Registered only once the session is personal, so every other session's tool list stays as it was. Either hook may
	// be the first to see it: `session_start` can fire before omp sets the flags, and a session can move in later.
	let mounted = false;
	const mount = (personal: Personal | null): void => {
		if (mounted || personal === null) return;
		mounted = true;
		pi.registerTool(
			rememberTool(
				pi,
				`Adds one fact about the user to their personal memory, which every later personal turn's system prompt carries. Use one short sentence that stays true, at most ${MAX_FACT_LENGTH} characters.`,
				async ({ cwd }) => (await personalIn(cwd))?.memory ?? notPersonal("personal memory"),
			),
		);
		if (personal.sport !== null) pi.registerTool(sportTool(pi, async ({ cwd }) => (await personalIn(cwd))?.sport ?? notPersonal("Sport module")));
	};

	pi.on("session_start", async (_event, ctx) => mount(await personalIn(ctx.cwd)));

	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.agent.kind === "sub") return undefined;
		const personal = await personalIn(ctx.cwd);
		if (personal === null) return undefined;
		mount(personal);
		const today = personal.sport && todayLine(readSport(personal.sport), localDay());
		const framing = personal.assistant ? ASSISTANT : PROJECT;
		return { systemPrompt: [...event.systemPrompt, [`${framing} ${MEMORY}`, ...memoryLines(personal.memory), ...(today ? [today] : [])].join("\n")] };
	});
}
