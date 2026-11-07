// omp-agents personal sessions: a session whose directory is the dashboard's personal directory turns from a coding
// agent into the user's personal assistant, with what it remembers about them on every turn and the `remember` tool, the
// one writer of that memory, and, when the dashboard names the Sport module's files, the `sport` tool and today's
// training on every turn. The dashboard loads it with `omp -e` and the flags in `PERSONAL_FLAGS` into every session it
// starts that is not a Bot's (`personalJoin` in src/server/personal.ts); it reads the directory each turn, so a session
// that moves in or out follows.
import { MAX_FACT_LENGTH } from "../shared/bots";
import { localDay } from "../shared/days";
import { type ExtensionApi, flagValue, memoryLines, rememberTool } from "./extension-kit";
import { readSport, type SportPaths, sportTool, todayLine } from "./sport-tool";

/** The flags a dashboard session starts with: the personal directory, the Markdown memory every personal session shares, and the Sport module's file and inbox. */
export const PERSONAL_FLAGS = {
	dir: "omp-agents-personal-dir",
	memory: "omp-agents-personal-memory",
	sport: "omp-agents-sport-file",
	sportInbox: "omp-agents-sport-inbox",
} as const;

const FRAMING =
	"You are the user's personal assistant, not a coding agent on a project. You help with everyday life such as meals and recipes, shopping, plans, habits and family logistics. Keep any file you make in this directory. What you know about the user follows; a later fact overrides an earlier one. When the user tells you something about themselves worth keeping, such as a preference, an allergy, or a household fact, call `remember` with one short sentence. Never remember secrets such as passwords or card numbers.";

export default function personalExtension(pi: ExtensionApi): void {
	pi.registerFlag(PERSONAL_FLAGS.dir, { type: "string", description: "The omp-agents personal directory." });
	pi.registerFlag(PERSONAL_FLAGS.memory, { type: "string", description: "The Markdown memory personal sessions remember in." });
	pi.registerFlag(PERSONAL_FLAGS.sport, { type: "string", description: "The omp-agents Sport module's file, which personal sessions read." });
	pi.registerFlag(PERSONAL_FLAGS.sportInbox, { type: "string", description: "The directory personal sessions leave their Sport changes in for the dashboard." });

	/**
	 * What a session in `cwd` reads and writes as a personal session: the memory, and the Sport module's paths when the
	 * dashboard named them; `null` when `cwd` is not the personal directory or the dashboard named no memory.
	 */
	const personalIn = (cwd: string): { memory: string; sport: SportPaths | null } | null => {
		const memory = flagValue(pi, PERSONAL_FLAGS.memory);
		if (memory === null || cwd !== flagValue(pi, PERSONAL_FLAGS.dir)) return null;
		const file = flagValue(pi, PERSONAL_FLAGS.sport);
		const inbox = flagValue(pi, PERSONAL_FLAGS.sportInbox);
		return { memory, sport: file !== null && inbox !== null ? { file, inbox } : null };
	};

	const notPersonal = (what: string): never => {
		throw new Error(`This session is not in the personal directory, so it has no ${what}.`);
	};

	// Registered only once the session is personal, so every other session's tool list stays as it was. Either hook may
	// be the first to see it: `session_start` can fire before omp sets the flags, and a session can move in later.
	let mounted = false;
	const mount = (cwd: string): void => {
		const personal = personalIn(cwd);
		if (mounted || personal === null) return;
		mounted = true;
		pi.registerTool(
			rememberTool(
				pi,
				`Adds one fact about the user to their personal memory, which every later personal turn's system prompt carries. Use one short sentence that stays true, at most ${MAX_FACT_LENGTH} characters.`,
				({ cwd }) => personalIn(cwd)?.memory ?? notPersonal("personal memory"),
			),
		);
		if (personal.sport !== null) pi.registerTool(sportTool(pi, ({ cwd }) => personalIn(cwd)?.sport ?? notPersonal("Sport module")));
	};

	pi.on("session_start", (_event, ctx) => mount(ctx.cwd));

	pi.on("before_agent_start", (event, ctx) => {
		const personal = personalIn(ctx.cwd);
		if (ctx.agent.kind === "sub" || personal === null) return undefined;
		mount(ctx.cwd);
		const today = personal.sport && todayLine(readSport(personal.sport), localDay());
		return { systemPrompt: [...event.systemPrompt, [FRAMING, ...memoryLines(personal.memory), ...(today ? [today] : [])].join("\n")] };
	});
}
