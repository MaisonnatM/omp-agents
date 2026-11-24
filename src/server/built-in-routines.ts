/**
 * The routines the dashboard adds by itself, each with the Bot that runs it, disabled until you turn one on. Each is
 * added once: one you delete stays deleted. A routine whose prompt is still a past built-in version gets the current one.
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
	/** The prompts earlier versions of the dashboard saved for this routine, oldest first; a stored one of these is replaced. */
	pastPrompts: readonly string[];
}

const HARNESS_BOT_ID = "harness-review" as BotId;

/** Where the weekly harness review keeps its replay tasks, its reports, and their replays: outside every checkout, as `model-replay.ts run` needs. */
export const HARNESS_REVIEW_DIR = "~/.cache/omp-harness-review";

/** The weekly harness review's prompt before it saved its replays and judged last week's; kept to upgrade a routine still holding it. */
const HARNESS_REVIEW_PROMPT_V1 = [
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

const replay = "bun scripts/token-audit/model-replay.ts";

/**
 * What the weekly harness review reads, judges, groups, proposes, and saves for replay. It changes no repository: it
 * writes only under {@link HARNESS_REVIEW_DIR}.
 */
export const HARNESS_REVIEW_PROMPT = [
	"Review how the agent harness failed this past week, judge whether last week's proposed change fixed what it was meant to, and propose one change.",
	`Do not edit, commit, or push anything in any repository, and do not run \`${replay} run\` or \`judge\`, which cost money: the only files you may write are under \`${HARNESS_REVIEW_DIR}/\`.`,
	"Below, `<today>` is today's date as YYYY-MM-DD.",
	"",
	"First, last week's verdict:",
	`- Find the newest \`${HARNESS_REVIEW_DIR}/<date>-review.md\` dated before today, the review that proposed last week's change and named its failures to replay, and its replay folder \`${HARNESS_REVIEW_DIR}/<date>/\`.`,
	"- If there is no such review, skip this part.",
	"- If the folder holds no `result.json`, say in one line that last week's replay was never run, and repeat the command that review ended with.",
	`- Otherwise run \`${replay} summary --by-task --out ${HARNESS_REVIEW_DIR}/<date>\` and, for each replayed failure, say whether the change fixed it: whether the replay kept the checks that passed at its base, whether the checks that failed there now pass, and, from its \`change.diff\`, whether it did what the review said should happen instead.`,
	"",
	"Then read this past week:",
	`- The last 7 days of \`${join(configDir, "ship-trace.jsonl")}\`, one JSON line per ship stage of every repository, yampa-ai/yampa included: its refusals (\`refusal\`), fix rounds (\`round\`), checks, and cost.`,
	"  Count as escalated a pull request whose fix hit its round budget (a refusal saying the fix has run its rounds) or stalled (a refusal saying the count did not shrink), since both need me to approve more rounds with `moreRounds`, and say when a fix round was recorded after one, which means I did.",
	"- `LEARNINGS.md` in this workspace, the omp-agents checkout: the lessons already written down.",
	`- The failed lands: the merges whose \`state.kind\` is \`failed\` in \`${mergesFile}\`.`,
	`- The failed sessions: the routine runs with \`errors\` or a \`failed\` outcome in \`${routinesFile}\`, and the dashboard's "exited early" and "stopped mid-turn" notifications.`,
	"",
	"Then reply with:",
	"1. Last week's verdict, as above.",
	"2. The failures and escalations, grouped by cause, each group with its count, its repositories and pull requests, and one example.",
	"3. Exactly one harness change, as a decision for me: the problem it fixes, the change (a skill, an extension, a check, or a rule), and what it costs. Do not make it.",
	"   A replay loads no extension but `cache-tail.ts`, so it tests a skill, a rule, or a repository check, not an extension; when the change is an extension, say so and name instead the `bun scripts/evals/run.ts` run that would measure it with the full harness, such as its `--disable-extensions <name>` arm, as `docs/architecture/evals.md` says, without running it.",
	"4. Five past failures to replay to test that change: for each, its session id, repository, and pull request, what failed, and what the change should make happen instead.",
	"   Pick sessions whose first request states the work, without pointing at `local://` or `agent://` files.",
	"",
	"Then save the replay:",
	`- Run \`mkdir -p ${HARNESS_REVIEW_DIR}\` and \`${replay} candidates --sessions <the five session ids, comma-separated> > ${HARNESS_REVIEW_DIR}/<today>-tasks.json\`, which turns each session into a replay task from the commit it started at, and say which sessions it left out and why.`,
	`- Write your whole reply to \`${HARNESS_REVIEW_DIR}/<today>-review.md\`, so next week's review can judge it.`,
	`- End your reply with the command to run once the change lands: \`${replay} run --tasks ${HARNESS_REVIEW_DIR}/<today>-tasks.json --models <worker model> --out ${HARNESS_REVIEW_DIR}/<today>\`, where the worker model is the \`task\` role in \`modelRoles\` of \`~/.omp/agent/config.yml\`.`,
	"",
	"If the week holds no failures, say so in one line, after last week's verdict.",
].join("\n");

const RECEIPT_BOT_ID = "routine-receipt" as BotId;

/** What the Friday receipt reads from `routines.json` and the verdict it gives each routine. It changes nothing. */
export const ROUTINE_RECEIPT_PROMPT = [
	"Write this week's receipt for my routines. Read only: do not edit, enable, disable, or delete any routine, file, or repository.",
	"",
	`Read \`${routinesFile}\`. Each routine has its \`name\`, \`enabled\`, \`schedules\`, and \`runs\`, newest first; each run has \`at\` (milliseconds), its \`outcome\`, its \`errors\`, and, for a message run whose Bot's turn ended, \`usage\` with \`tokens\` and \`cost\` in dollars.`,
	"Count only the runs of the last 7 days. A run is useful when it posted something worth reading: a message run whose Bot did not stay quiet and that has no errors, or a command run whose output was posted. A run that stayed quiet, was skipped, or failed is not.",
	"To tell a quiet message run, open its conversation's session file (its `outcome.sessionId`) when you need to, and look for a `stay_quiet` tool call after the run's prompt.",
	"",
	"Reply with one table, one row per routine with at least one run this week, most costly first: routine, runs, useful runs, tokens, cost, and a verdict.",
	"The verdict is keep (most runs are useful), slow down (it runs much more often than it has news; say to what schedule), or retire (no useful run this week, or every run failed), with a reason of a few words.",
	"Then one line with the week's total cost and run count, and one line naming the enabled routines that did not run at all.",
	"If no routine ran this week, say so in one line.",
].join("\n");

/** The built-in routines, in the order they are added. */
export const BUILT_IN_ROUTINES: readonly BuiltInRoutine[] = [
	{
		bot: {
			id: HARNESS_BOT_ID,
			kind: "routines",
			name: "Harness review",
			job: `Once a week, read how the agent harness failed, judge last week's proposed change, and propose one change to it as a decision for me.\nNever edit, commit, or push in a repository: write only under ${HARNESS_REVIEW_DIR}/.`,
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
		pastPrompts: [HARNESS_REVIEW_PROMPT_V1],
	},
	{
		bot: {
			id: RECEIPT_BOT_ID,
			kind: "routines",
			name: "Routine receipt",
			job: "Every Friday, list what each routine did and cost this week, and say which to keep, slow down, or retire.\nRead only: never change a routine yourself.",
			cwd: sourceDir,
			model: null,
			skill: null,
			...defaultLook(RECEIPT_BOT_ID),
		},
		routine: {
			id: "routine-receipt-weekly",
			botId: RECEIPT_BOT_ID,
			name: "Friday routine receipt",
			schedules: [{ kind: "weekly", days: [5], time: { hour: 17, minute: 0 } }],
			triggers: [],
			task: { kind: "prompt", prompt: ROUTINE_RECEIPT_PROMPT },
			enabled: false,
		},
		pastPrompts: [],
	},
];

/** What adding the built-in routines needs: whether a Bot exists, a stored routine, and how to save a Bot and a routine. */
export interface BuiltInSaves {
	hasBot(id: BotId): boolean;
	routine(id: string): RoutineSpec | undefined;
	saveBot(bot: BotSpec): void;
	saveRoutine(routine: RoutineSpec): void;
}

/**
 * Adds each of `builtIns` that the file at `addedPath` does not list yet, with its Bot unless that Bot exists, and lists
 * it there. A second call adds nothing, and a routine you delete is not added again. A listed routine whose prompt is
 * one of its `pastPrompts` gets the current prompt; one you edited keeps yours.
 */
export function addBuiltInRoutines(addedPath: string, saves: BuiltInSaves, builtIns: readonly BuiltInRoutine[] = BUILT_IN_ROUTINES): void {
	const added = new JsonFile<string[]>(addedPath, { parse: value => (isTexts(value) ? value : null), holds: "a list of routine ids", onInvalid: "ignore" });
	const before = added.load() ?? [];
	for (const { routine, pastPrompts } of builtIns) {
		if (!before.includes(routine.id)) continue;
		const stored = saves.routine(routine.id);
		if (stored?.task.kind !== "prompt" || !pastPrompts.includes(stored.task.prompt)) continue;
		const { id, botId, name, schedules, triggers, enabled } = stored;
		saves.saveRoutine({ id, botId, name, schedules, triggers, enabled, task: routine.task });
	}
	const fresh = builtIns.filter(({ routine }) => !before.includes(routine.id));
	if (fresh.length === 0) return;
	for (const { bot, routine } of fresh) {
		if (!saves.hasBot(bot.id)) saves.saveBot(bot);
		saves.saveRoutine(routine);
	}
	added.save([...before, ...fresh.map(({ routine }) => routine.id)]);
}
