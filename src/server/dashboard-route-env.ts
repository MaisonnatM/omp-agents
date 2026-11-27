/** The HTTP API's {@link RouteEnv} over the dashboard's parts, handing each route group only its part. */
import type { ForeignUsage } from "../foreign/usage";
import type { Integrations } from "../integrations";
import { startOwnedService } from "../omp/daemons";
import { checkOutPullRequest } from "../pull-request-checkout";
import { rebasePullRequest } from "../pull-request-rebase";
import type { ServedBuild } from "../served-build";
import type { SettingsSync } from "../settings-sync";
import type { StartRequest, StartResult } from "../shared/sessions";
import type { SourceControl } from "../source-control";
import type { Terminals } from "../terminals";
import type { Worktrees } from "../worktrees";
import type { OwnerLock } from "../../templates/omp/agent/extensions/github/owner-lock";
import type { ActivityStore } from "./activity-store";
import type { Broadcasts } from "./broadcasts";
import { startDevServer } from "./dev-server";
import type { Guards } from "./http";
import type { IsolationSweep } from "./isolation-sweep";
import type { ListRegistry } from "./list-registry";
import type { LiveSessions } from "./live-sessions";
import type { MergeQueue } from "./merge-queue";
import type { KeepRebased } from "./keep-rebased";
import type { PhoneAccessRoutesEnv } from "./phone-access-routes";
import type { ProcessSettingsFile } from "./process-settings-file";
import type { ReviewDrafts } from "./review-drafts";
import type { RouteEnv } from "./routes";
import type { SelfUpdate } from "./self-update";
import type { SessionFiles } from "./session-files";
import type { SessionProcessWatch } from "./session-processes";
import type { WorkspacesFile } from "./workspaces-file";

/** The dashboard's parts the HTTP API reads and acts through. */
export interface DashboardRouteParts {
	files: SessionFiles;
	sessions: LiveSessions;
	broadcasts: Broadcasts;
	lists: ListRegistry;
	workspaces: WorkspacesFile;
	foreignUsage: ForeignUsage;
	sourceControl: SourceControl;
	ownerLock: OwnerLock;
	integrations: Integrations;
	worktrees: Worktrees;
	terminals: Terminals;
	isolationSweep: IsolationSweep;
	mergeQueue: MergeQueue;
	/** **Keep rebased**, whose switch `/api/keep-rebased` reads and changes. */
	keepRebased: KeepRebased;
	reviewDrafts: ReviewDrafts;
	startSession(request: StartRequest): Promise<StartResult>;
	selfUpdate: SelfUpdate;
	settingsSync: SettingsSync;
	activity: ActivityStore;
	processWatch: SessionProcessWatch;
	processSettings: ProcessSettingsFile;
	/** The workspaces sessions count in: live ones first, then saved ones newest first. */
	knownWorkspaces(): string[];
	/** The known workspaces and the ones Settings added, without the hidden ones. */
	workspaceCwds(): string[];
}

/** The HTTP API's env over `parts`, admitted by `guards`; `build` is what the server serves. */
export function dashboardRouteEnv(parts: DashboardRouteParts, guards: Guards, build: ServedBuild, phoneAccess: PhoneAccessRoutesEnv): RouteEnv {
	const { files, sessions, broadcasts, lists, sourceControl, mergeQueue, reviewDrafts, selfUpdate, processWatch, processSettings } = parts;
	return {
		guards,
		modules: { workspaces: () => parts.workspaceCwds() },
		sessions: {
			knownWorkspaces: () => parts.knownWorkspaces(),
			addedCwds: () => parts.workspaces.value.added,
			changeWorkspaces: change => void lists.apply("workspaces", change),
			changeProjectTrust: change => void lists.apply("project-trust", change),
			summaryOf(sessionId) {
				const saved = files.savedOf(sessionId);
				return saved && { file: saved.path, title: saved.title, workspace: files.facts.placement.cwdOf(saved.cwd) };
			},
			foreignUsage: () => parts.foreignUsage.read(),
			placeOf(sessionId) {
				const file = files.pathOf(sessionId);
				const saved = files.savedOf(sessionId);
				if (!file || !saved) return null;
				return { file, dir: files.factsOf(sessionId).worktree ?? sessions.bySessionId(sessionId)?.cwd ?? saved.cwd, changedPaths: () => files.facts.changedPathsOf(file) };
			},
			learnHeads(repo, pullRequests) {
				if (files.facts.learnHeads(repo, pullRequests)) broadcasts.pushAll();
			},
			searchConversations: query => files.searchConversations(query),
			sourceControl: () => sourceControl.answer(parts.workspaceCwds()),
			changeSourceControl: change => {
				if (sourceControl.apply(change) && change.op !== "clean-up" && parts.ownerLock.held) void sourceControl.pull(parts.workspaceCwds());
			},
		},
		integrations: parts.integrations,
		files: { worktrees: parts.worktrees, terminals: parts.terminals, fileDirsOf: files.fileDirsOf },
		artifacts: { sessionFileOf: id => sessions.fileOf(id, files.pathOf) },
		storage: parts.isolationSweep,
		pullRequests: {
			changeMergeQueue: async change => {
				const merged = await mergeQueue.apply(change);
				return { merges: [...mergeQueue.list], merged };
			},
			previewReviewDraft: pr => reviewDrafts.preview(pr),
			postReviewDraft: (pr, submit) => reviewDrafts.post(pr, submit),
			checkOutPullRequest: checkout => checkOutPullRequest(checkout, parts.startSession),
			rebasePullRequest,
			keepRebased: () => ({ repos: [...parts.keepRebased.repos] }),
			changeKeepRebased: change => {
				parts.keepRebased.apply(change);
				return { repos: [...parts.keepRebased.repos] };
			},
		},
		dashboard: { build, status: () => selfUpdate.status(), update: () => selfUpdate.update(), changelog: () => selfUpdate.changelog() },
		sync: parts.settingsSync,
		activity: parts.activity,
		processes: {
			list: () => processWatch.list(),
			stop: ({ instanceId, id }) => processWatch.stop(instanceId, id),
			startServer: async instanceId => {
				const session = sessions.get(instanceId);
				if (!session) throw new Error("That session no longer runs.");
				return startDevServer(session.sessionId, files.factsOf(session.sessionId).worktree ?? session.cwd, startOwnedService);
			},
			settings: () => {
				processSettings.reload();
				return processSettings.value;
			},
			changeSettings: settings => {
				processSettings.apply(settings);
				return processSettings.value;
			},
		},
		phoneAccess,
	};
}
