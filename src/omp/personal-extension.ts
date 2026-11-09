// omp-agents personal sessions: a session in the Personal space, the dashboard's personal directory or a workspace
// Settings › Workspaces placed there, gets what it remembers about the user on every turn and the `remember` tool, the
// one writer of that memory, and, when the dashboard names the Sport module's files, the `sport` tool and today's
// training on every turn; in the personal directory itself it turns from a coding agent into the user's personal
// assistant. The dashboard loads it with `omp -e` and the flags in `PERSONAL_FLAGS` into every session it starts that is
// not a Bot's (the server's `personalJoin`); it reads the space each turn, so a session that moves in or
// out, or whose workspace changes space, follows.
import { worktreeAt } from "../git";
import { workspaceFor } from "../paths";
import { MAX_FACT_LENGTH } from "../shared/bots";
import { localDay } from "../shared/days";
import { spaces, type Workspace } from "../shared/workspaces";
import { readWorkspaces } from "../workspace-list";
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

/** What the dashboard's flags name: the personal directory, the workspaces file when it named one, the memory, and the Sport module's paths when it named them. */
interface Flags {
	dir: Workspace;
	workspaces: string | null;
	memory: string;
	sport: SportPaths | null;
}

/** What a personal session reads and writes, and the framing its prompt opens with: the assistant's in the personal directory itself, a Personal project's elsewhere. */
interface Personal {
	memory: string;
	sport: SportPaths | null;
	framing: string;
}

export default function personalExtension(pi: ExtensionApi): void {
	pi.registerFlag(PERSONAL_FLAGS.dir, { type: "string", description: "The omp-agents personal directory." });
	pi.registerFlag(PERSONAL_FLAGS.workspaces, { type: "string", description: "The omp-agents workspaces file, which places workspaces in the Personal space." });
	pi.registerFlag(PERSONAL_FLAGS.memory, { type: "string", description: "The Markdown memory personal sessions remember in." });
	pi.registerFlag(PERSONAL_FLAGS.sport, { type: "string", description: "The omp-agents Sport module's file, which personal sessions read." });
	pi.registerFlag(PERSONAL_FLAGS.sportInbox, { type: "string", description: "The directory personal sessions leave their Sport changes in for the dashboard." });

	const placement = new WorkspacePlacement();

	// Read once omp has set them, which can be after the first `session_start`; until then every session is plain.
	let flags: Flags | null = null;
	const flagsOf = (): Flags | null => {
		if (flags !== null) return flags;
		const memory = flagValue(pi, PERSONAL_FLAGS.memory);
		const dir = flagValue(pi, PERSONAL_FLAGS.dir);
		if (memory === null || dir === null) return null;
		const file = flagValue(pi, PERSONAL_FLAGS.sport);
		const inbox = flagValue(pi, PERSONAL_FLAGS.sportInbox);
		flags = { dir: workspaceFor(dir), workspaces: flagValue(pi, PERSONAL_FLAGS.workspaces), memory, sport: file !== null && inbox !== null ? { file, inbox } : null };
		return flags;
	};

	/**
	 * What a session in `cwd` reads and writes as a personal session; `null` when `cwd` is in the Work space or the dashboard
	 * named no memory. The workspaces file is read each time, so a workspace Settings › Workspaces moves follows.
	 */
	const personalIn = async (cwd: string): Promise<Personal | null> => {
		const named = flagsOf();
		if (named === null) return null;
		const workspace = await placement.workspaceOf(cwd, worktreeAt);
		const space = spaces((named.workspaces !== null ? readWorkspaces(named.workspaces)?.personal : undefined) ?? [], named.dir);
		if (space.of(cwd, workspace) === "work") return null;
		return { memory: named.memory, sport: named.sport, framing: space.isPersonalDir(cwd) ? ASSISTANT : PROJECT };
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
		return { systemPrompt: [...event.systemPrompt, [`${personal.framing} ${MEMORY}`, ...memoryLines(personal.memory), ...(today ? [today] : [])].join("\n")] };
	});
}
