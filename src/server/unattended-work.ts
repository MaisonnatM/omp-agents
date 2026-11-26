/**
 * The work that runs without a page: the routine and scheduled-send runners, the modules' runs, the continues, the merge
 * queue and the cleanup after a merge, and the modules' file inboxes, each acting only on the server that holds the owner lock.
 */
import { randomUUID } from "node:crypto";
import { fullyAwake } from "../full-wake";
import type { LiveSession } from "../live-session";
import { isStoredModuleId, type ModuleChanges, type ModuleFiles, type ModuleRun, moduleInboxes, moduleRuns, type StoredModuleId } from "../modules";
import { directoryOf } from "../paths";
import { runShell } from "../proc";
import { GITHUB_MERGES, readPullRequestStates } from "../pull-request-merge";
import { repoOf } from "../pull-requests";
import { worktreeAt } from "../git";
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT } from "../routines";
import { newSessionRequest, type RosterHost, type StartRequest, type StartResult } from "../shared/sessions";
import type { SourceControl } from "../source-control";
import type { Worktrees } from "../worktrees";
import { configAt } from "../../templates/omp/agent/extensions/land/gate";
import { AutoContinue, occupiedBy } from "./auto-continue";
import { boardCheckout, landBoardBranch } from "./board-checkout";
import type { Broadcasts } from "./broadcasts";
import type { JsonInboxDir } from "./json-inbox";
import type { ListRegistry } from "./list-registry";
import type { LiveSessions } from "./live-sessions";
import { MergeCleanup } from "./merge-cleanup";
import { MergeQueue } from "./merge-queue";
import { RoutineRunner } from "./routine-runner";
import { boardRunTurn } from "./routine-turns";
import type { RoutinesFile } from "./routines-file";
import type { ScheduledFile } from "./scheduled-file";
import { ScheduledRunner } from "./scheduled-runner";
import type { UsagePoll } from "./usage-poll";
import { builtInRoutinesFile, mergesFile } from "../paths";
import { addBuiltInRoutines } from "./built-in-routines";
import type { TriggerWatch } from "./routine-triggers";

/** The dashboard's parts the unattended work reads and acts through. */
export interface UnattendedWorkDeps {
	sessions: LiveSessions;
	hosts(): RosterHost[];
	modules: ModuleFiles;
	/** Applies a module change and writes it now; a refused change throws. */
	applyModuleNow<I extends StoredModuleId>(id: I, change: ModuleChanges[I]): boolean;
	lists: ListRegistry;
	broadcasts: Broadcasts;
	routines: RoutinesFile;
	scheduled: ScheduledFile;
	/** What the bell's checks saw last, which tells the routines' triggers what is new. */
	triggerWatch: TriggerWatch;
	/** The file of session `sessionId`, `null` when none is known. */
	pathOf(sessionId: string): string | null;
	sourceControl: SourceControl;
	worktrees: Worktrees;
	usage: UsagePoll;
	start(request: StartRequest): Promise<StartResult>;
	/** The live session that continues `sessionId`, else that session resumed; rejects when it does not resume. */
	reach(sessionId: string): Promise<LiveSession>;
	/** Ends a live session as **End session** does. */
	endLive(session: LiveSession): Promise<void>;
	/** Whether this server holds the owner lock. */
	owner(): boolean;
	/** Lets project code run in `dir`, or throws when the user has not trusted it as it is now. */
	admit(dir: string): Promise<void>;
	/** Aborts as the dashboard stops, which stops every routine command still running. */
	stopping: AbortSignal;
}

/** The unattended work's parts, which the dashboard starts, ticks, and stops. */
export interface UnattendedWork {
	runner: RoutineRunner;
	scheduledRunner: ScheduledRunner;
	moduleRuns: Map<StoredModuleId, ModuleRun>;
	autoContinue: AutoContinue;
	mergeCleanup: MergeCleanup;
	mergeQueue: MergeQueue;
	/** The inboxes the owner applies, each a tool's changes to one of the dashboard's files. */
	inboxes: JsonInboxDir<unknown>[];
	/** The steps of taking over routines and the file inboxes from the server that ran them. */
	takeOver(): void;
}

export function unattendedWork(deps: UnattendedWorkDeps): UnattendedWork {
	const { sessions, modules, applyModuleNow, lists, broadcasts, routines, scheduled, triggerWatch, worktrees, start: startSession, reach, owner: ownerHeld, admit, stopping } = deps;
	/** Adds the built-in routines not added before, disabled; only the server that runs routines adds them. */
	const addBuiltIns = (): void => {
		addBuiltInRoutines(builtInRoutinesFile, routine => lists.apply("routines", { op: "save", routine }));
	};
	const inboxes = moduleInboxes(modules, applyModuleNow, { active: ownerHeld });
	const runner = new RoutineRunner({
		file: routines,
		now: Date.now,
		async exec(command, cwd, env) {
			const dir = await directoryOf(cwd);
			if (!dir) throw new Error(`${cwd.trim()} is not a directory.`);
			return runShell(command, dir, { timeoutMs: COMMAND_TIMEOUT_MS, maxOutput: MAX_COMMAND_OUTPUT, signal: stopping, env });
		},
		fullyAwake,
		onChange: () => broadcasts.pushList("routines"),
		board: () => modules.board.value,
		postBoard: change => {
			if (!applyModuleNow("board", change)) throw new Error("The Board could not be saved.");
			return change.op === "reply" ? change.task : modules.board.value.tasks.at(-1)!.id;
		},
		turnOf: (task, at) => boardRunTurn(modules.board.value, task, at, deps.pathOf),
	});
	const scheduledRunner = new ScheduledRunner({
		file: scheduled,
		start: startSession,
		reach,
		now: Date.now,
		onChange: () => broadcasts.pushList("scheduled"),
	});
	const runs = moduleRuns(modules, applyModuleNow, {
		async start(cwd, prompt, launch, task) {
			const result = await startSession(newSessionRequest(cwd, prompt, { ...launch, taskId: task }));
			// A session already holding `task`, such as one a restart cut off before its start was recorded, is the one to keep.
			let instanceId: string;
			if (result.ok) instanceId = result.instanceId;
			else if (result.owner?.here) instanceId = result.owner.instanceId;
			else return { error: result.error };
			const sessionId = sessions.get(instanceId)?.sessionId;
			return sessionId ? { sessionId } : { error: "The session exited as it started." };
		},
		async wake(sessionId, text, launch, interrupt = false) {
			const live = sessions.bySessionId(sessionId);
			const session = live ?? (await reach(sessionId));
			// The turn stops, and the user's own messages it held wait until `text` has run; a stopped session has no turn to stop.
			const withdrawn = interrupt && live ? await live.interrupt() : [];
			// Only a session this dashboard started switches models; one running in a terminal keeps its own.
			const owned = sessions.started(session.instanceId);
			if (launch?.model) await owned?.setModel(launch.model, launch.thinking);
			else if (launch?.thinking) await owned?.setThinking(launch.thinking);
			await session.prompt(null, launch?.skill ? `/skill:${launch.skill} ${text}` : text, [], "followUp");
			for (const message of withdrawn) await session.prompt(null, message.text, message.images, "followUp");
			return { resumed: !live };
		},
		working: sessionId => {
			const status = sessions.bySessionId(sessionId)?.row().status;
			return status !== undefined && status !== "idle";
		},
		alive: sessionId => sessions.bySessionId(sessionId) !== undefined,
		async end(sessionId) {
			const live = sessions.bySessionId(sessionId);
			if (live) await deps.endLive(live);
		},
		// In the checkout chain, so a worktree removal running meanwhile neither races the add nor removes what it added.
		checkout: (workspace, branch) => worktrees.checkout(() => boardCheckout(workspace, branch, admit)),
		land: (workspace, branch, sessionId) => landBoardBranch(workspace, branch, sessionId, admit),
		landable: workspace => configAt(workspace) !== null,
		owner: ownerHeld,
		now: Date.now,
	});
	const autoContinue = new AutoContinue({
		file: scheduled,
		plans: async () => {
			const { plans, error } = await deps.usage.fresh();
			if (error !== null) throw new Error(error);
			return plans;
		},
		now: Date.now,
		onChange: () => broadcasts.pushList("scheduled"),
	});
	// Only the server that holds the owner lock steps the queue and takes the minute tick's look, so only it ends sessions after a merge, and only the ones it started.
	const mergeCleanup = new MergeCleanup({
		sessions: () =>
			deps.hosts().flatMap(host =>
				sessions.started(host.instanceId) !== undefined && deps.sourceControl.cleanUp
					? [{ sessionId: host.sessionId, idle: host.status === "idle", occupied: occupiedBy(host.status, autoContinue.held(host.sessionId)), pullRequests: host.pullRequests, workDir: host.worktree ?? host.cwd, branch: host.branch?.linked ? host.branch.name : null }]
					: [],
			),
		states: readPullRequestStates,
		checkout: async dir => {
			const at = await worktreeAt(dir).catch(() => null);
			return at && { gitDir: at.common, repo: await repoOf(dir) };
		},
		end: async sessionId => {
			const session = sessions.bySessionId(sessionId);
			if (!session) throw new Error("It does not run.");
			await deps.endLive(session);
		},
		deleteBranch: (gitDir, branch, head) => worktrees.deleteMergedBranch(gitDir, branch, head),
	});
	const mergeQueue = new MergeQueue({
		path: mergesFile,
		github: GITHUB_MERGES,
		now: Date.now,
		newId: randomUUID,
		active: ownerHeld,
		onChange: () => broadcasts.pushList("merges"),
		onMerged: pr => void mergeCleanup.merged(pr),
	});
	const takeOver = (): void => {
		// What the server that ran them saved since this one started, which the modules' runs and inboxes go on from.
		for (const id of Object.keys(modules))
			if (isStoredModuleId(id)) {
				modules[id].reload();
				broadcasts.pushList(id);
			}
		routines.reload();
		routines.migrate();
		addBuiltIns();
		broadcasts.pushList("routines");
		runner.recover();
		scheduledRunner.recover();
		for (const inbox of inboxes) void inbox.drain();
		for (const run of runs.values()) run.changed();
		// It learned what the triggers see while another server ran routines, which that server fired.
		triggerWatch.forget();
	};
	return { runner, scheduledRunner, moduleRuns: runs, autoContinue, mergeCleanup, mergeQueue, inboxes, takeOver };
}
