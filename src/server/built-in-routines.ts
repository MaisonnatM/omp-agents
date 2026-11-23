/**
 * The routines the dashboard adds by itself, each with the Bot that runs it, disabled until you turn one on. Each is
 * added once: one you delete stays deleted.
 */
import { join } from "node:path";
import { JsonFile } from "../fs";
import { isTexts } from "../json";
import { configDir, mergesFile, routinesFile } from "../paths";
import type { RoutineSpec } from "../routines";
import { type BotId, type BotSpec, defaultLook } from "../shared/bots";
import { sourceDir } from "./resources";

/** A routine the dashboard adds by itself, with the Bot that runs it, which it adds too unless that Bot exists. */
export interface BuiltInRoutine {
	bot: BotSpec;
	routine: RoutineSpec;
}

const HARNESS_BOT_ID = "harness-review" as BotId;

/** What the weekly harness review reads, groups, and proposes; it changes no file. */
export const HARNESS_REVIEW_PROMPT = [
	"Review how the agent harness failed this past week, and propose one change to it. Do not edit, commit, or push anything: this run only reads and reports.",
	"",
	"Read:",
	`- The last 7 days of \`${join(configDir, "ship-trace.jsonl")}\`, one JSON line per recorded ship stage: its refusals (\`refusal\`), fix rounds (\`round\`), checks, and cost.`,
	"- `LEARNINGS.md` in this workspace, the omp-agents checkout: the lessons already written down.",
	`- The failed lands: the merges whose \`state.kind\` is \`failed\` in \`${mergesFile}\`.`,
	`- The failed sessions: the routine runs with \`errors\` or a \`failed\` outcome in \`${routinesFile}\`, and the dashboard's "exited early" and "stopped mid-turn" notifications.`,
	"",
	"Then reply with:",
	"1. The failures, grouped by cause, each group with its count and one example.",
	"2. Exactly one harness change, as a decision for me: the problem it fixes, the change (a skill, an extension, a check, or a rule), and what it costs. Do not make it.",
	"3. Five past failures to replay to test that change: for each, the session or pull request, what failed, and what the change should make happen instead.",
	"",
	"If the week holds no failures, say so in one line.",
].join("\n");

/** The built-in routines, in the order they are added. */
export const BUILT_IN_ROUTINES: readonly BuiltInRoutine[] = [
	{
		bot: {
			id: HARNESS_BOT_ID,
			kind: "routines",
			name: "Harness review",
			job: "Once a week, read how the agent harness failed and propose one change to it as a decision for me.\nNever edit, commit, or push: only read and report.",
			cwd: sourceDir,
			model: null,
			skill: null,
			...defaultLook(HARNESS_BOT_ID),
		},
		routine: {
			id: "harness-review-weekly",
			botId: HARNESS_BOT_ID,
			name: "Weekly harness review",
			schedules: [{ kind: "weekly", days: [1], time: { hour: 9, minute: 0 } }],
			triggers: [],
			task: { kind: "prompt", prompt: HARNESS_REVIEW_PROMPT },
			enabled: false,
		},
	},
];

/** What adding the built-in routines needs: whether a Bot exists, and how to save a Bot and a routine. */
export interface BuiltInSaves {
	hasBot(id: BotId): boolean;
	saveBot(bot: BotSpec): void;
	saveRoutine(routine: RoutineSpec): void;
}

/**
 * Adds each of `builtIns` that the file at `addedPath` does not list yet, with its Bot unless that Bot exists, and lists
 * it there. A second call adds nothing, and a routine you delete is not added again.
 */
export function addBuiltInRoutines(addedPath: string, saves: BuiltInSaves, builtIns: readonly BuiltInRoutine[] = BUILT_IN_ROUTINES): void {
	const added = new JsonFile<string[]>(addedPath, { parse: value => (isTexts(value) ? value : null), holds: "a list of routine ids", onInvalid: "ignore" });
	const before = added.load() ?? [];
	const fresh = builtIns.filter(({ routine }) => !before.includes(routine.id));
	if (fresh.length === 0) return;
	for (const { bot, routine } of fresh) {
		if (!saves.hasBot(bot.id)) saves.saveBot(bot);
		saves.saveRoutine(routine);
	}
	added.save([...before, ...fresh.map(({ routine }) => routine.id)]);
}
