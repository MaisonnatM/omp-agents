/** What the bell's checks read, from omp, the dashboard's checkout, GitHub, Slack, and the dashboard's own parts. */
import { integrationFetch, integrationSignedIn } from "../integrations";
import { routineTurn } from "../live-session";
import { modelUpdates, upgradeModel } from "../settings";
import { installedOmp, latestOmp, updateOmp } from "../omp/release";
import { readCreditRuns } from "../omp/stats";
import { displayPath } from "../paths";
import { loadPullRequests } from "../pull-requests";
import { earlyRuns } from "../routine-health";
import { agentOn } from "../shared/moves";
import type { RosterHost } from "../shared/sessions";
import { macSleeps, sleptWithin } from "../sleep-log";
import { waitingOnYou } from "../slack-messages";
import type { PullRequestList } from "../shared/github";
import type { InterruptedSessions } from "./interrupted";
import type { NoticeSources } from "./notices";
import { pullRequestSightings, SLACK_SCOPE, slackSightings, type TriggerWatch } from "./routine-triggers";
import type { RoutinesFile } from "./routines-file";
import type { SelfUpdate } from "./self-update";
import type { SessionFiles } from "./session-files";
import type { UsagePoll } from "./usage-poll";

/** The dashboard's parts the bell's checks read. */
export interface NoticeSourcesDeps {
	selfUpdate: SelfUpdate;
	knownWorkspaces(): string[];
	hosts(): RosterHost[];
	triggerWatch: TriggerWatch;
	/** Hands the pull request watches the list the activity check read. */
	learnWatches(list: PullRequestList): void;
	pushRoster(): void;
	usage(): UsagePoll;
	files: SessionFiles;
	interrupted: InterruptedSessions;
	routines: RoutinesFile;
}

export function noticeSources(deps: NoticeSourcesDeps): NoticeSources {
	const { selfUpdate, triggerWatch, files, interrupted, routines } = deps;
	return {
		latestOmp,
		installedOmp,
		updateOmp,
		modelUpdates,
		upgradeModel,
		dashboardNews: () => selfUpdate.news(),
		updateDashboard: () => selfUpdate.update(),
		pullRequests: async () => {
			const list = await loadPullRequests(deps.knownWorkspaces(), false);
			const agent = agentOn(deps.hosts());
			triggerWatch.learn(pullRequestSightings(list, agent));
			deps.learnWatches(list);
			// A row shows its watched pull requests' checks, which this list may have changed.
			deps.pushRoster();
			return { list, agent };
		},
		slack: async () => {
			// Signed out, Slack answers nothing, so its next answer, once signed in, is a baseline rather than news.
			if (!(await integrationSignedIn("slack"))) {
				triggerWatch.forgetScope(SLACK_SCOPE);
				return [];
			}
			const found = await waitingOnYou(integrationFetch("slack"), Date.now());
			triggerWatch.learn(slackSightings(found));
			return found;
		},
		plans: async () => {
			const usage = deps.usage().report;
			if (usage === null) throw new Error("omp usage has not run yet");
			if (usage.error !== null) throw new Error(usage.error);
			return usage.plans;
		},
		creditRuns: () => readCreditRuns(Date.now()),
		stoppedSessions: () =>
			interrupted.midTurn().map(sessionId => {
				const saved = files.savedOf(sessionId);
				return { sessionId, title: saved?.title ?? null, cwdDisplay: saved ? displayPath(saved.cwd) : null };
			}),
		earlyRuns: async () => {
			const sleeps = await macSleeps();
			return earlyRuns(
				routines.value,
				Date.now(),
				(sessionId, routineId, at) => {
					const path = files.pathOf(sessionId);
					return path === null ? null : routineTurn(path, routineId, at);
				},
				(from, to) => sleptWithin(sleeps, from, to),
			);
		},
		now: Date.now,
	};
}
