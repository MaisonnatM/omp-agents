/** The server reads that components hold: one-off reads by URL, and the polled stores a sidebar list and its page share. */
import { useEffect, useMemo, useState } from "react";
import { decodeIntegrationsAnswer, type IntegrationsAnswer } from "../src/shared/accounts";
import { type Analytics, type AnalyticsSession, type ContextReport, decodeAnalytics } from "../src/shared/analytics";
import { type ActivityRead, decodeActivity } from "../src/shared/activity";
import { decodePullRequestList, type PullRequest, type PullRequestChange, type PullRequestDetail, type PullRequestEdit, type PullRequestList, type PullRequestViewedEdit, type RepoPullRequests } from "../src/shared/github";
import type { MergeQueueAnswer, MergeQueueChange } from "../src/shared/merge-queue";
import type { ModelEntry } from "../src/shared/models";
import type { ConversationHit, ConversationSearchAnswer } from "../src/shared/sessions";
import type { ProvidersAnswer } from "../src/shared/providers";
import type { McpServersAnswer } from "../src/shared/mcp-servers";
import type { DevServerRequest, DevServerStart, LiveSessionProcesses, ProcessStop } from "../src/shared/processes";
import type { CollabAutoStart, StarterKitStatus, TerminalAccess } from "../src/shared/readiness";
import type { SourceControlAnswer } from "../src/shared/source-control";
import type { WorkspaceChange } from "../src/shared/workspaces";
import { errorText } from "../src/json";
import { getJson, putJson } from "./api";
import { createPolledStore } from "./polled-store";
import { withPullRequestReviewers, withPullRequestState } from "./pull-requests-model";

export interface ReadState<T> {
	data: T | null;
	error: string | null;
}

export const UNREAD: ReadState<never> = { data: null, error: null };

/** The models that omp lists, as the server answers a read or sends them to a session. */
export type ModelList = ReadState<{ models: ModelEntry[] }>;

type Refreshable<T> = ReadState<T> & { refreshing: boolean };

const UNREAD_IDLE: Refreshable<never> = { ...UNREAD, refreshing: false };

/**
 * The server's answer at `url`, nothing while `url` is `null` or until it first answers for `url`, so an answer for a
 * previous `url` never shows. A change of `version` reads it again, keeping the last answer meanwhile and when that read
 * fails; `refreshing` holds until that read settles.
 */
export function useRead<T>(url: string | null, version?: unknown): Refreshable<T> {
	const [read, setRead] = useState<(ReadState<T> & { url: string; version: unknown }) | null>(null);
	useEffect(() => {
		if (url === null) return;
		const controller = new AbortController();
		// An abort makes `getJson` reject, so only the failure needs to tell it apart.
		getJson<T>(url, controller.signal).then(
			data => setRead({ url, version, data, error: null }),
			(err: unknown) => {
				if (!controller.signal.aborted) setRead(last => ({ url, version, data: last?.url === url ? last.data : null, error: errorText(err) }));
			},
		);
		return () => controller.abort();
	}, [url, version]);
	const current = read?.url === url ? read : null;
	const refreshing = current !== null && !Object.is(current.version, version);
	return useMemo(() => (current ? { data: current.data, error: current.error, refreshing } : UNREAD_IDLE), [current, refreshing]);
}

/** Setup checks stay in memory and poll only while Get started is visible. Optional processes never delay local facts. */
export const terminalSessionsStore = createPolledStore<CollabAutoStart>({ url: () => "/api/readiness/terminal-sessions", pollMs: 5_000 });
export const starterKitStore = createPolledStore<StarterKitStatus>({ url: () => "/api/readiness/starter-kit" });
/** The GitHub CLI's sign-in, the pull settings, and the workspaces' repositories, as Settings' Source control tab shows them. */
export const sourceControlStore = createPolledStore<SourceControlAnswer>({ url: () => "/api/source-control" });
/** What one session used over all time, its subagents folded in, by session id; `null` before its first request. */
export const sessionUsageStore = createPolledStore<AnalyticsSession | null>({
	url: session => `/api/analytics/session?${new URLSearchParams({ session: session ?? "" })}`,
	pollMs: 5_000,
});

export async function setTerminalAccess(access: TerminalAccess): Promise<void> {
	const answer = await putJson<CollabAutoStart>("/api/readiness/terminal-sessions", { access });
	terminalSessionsStore.update(() => answer);
}

/** Adds, hides, or shows the workspace `change` names; every page then hears the list after it over its socket. */
export async function writeWorkspace(change: WorkspaceChange): Promise<void> {
	await putJson("/api/workspaces", change);
}

/** Creates the directory `path` names, with any parent it lacks, and adds it as a workspace. */
export async function createWorkspace(path: string): Promise<void> {
	await putJson("/api/workspaces", { op: "add", cwd: path, create: true });
}

/** The scope {@link pullRequestsStore} keys a window's pull requests by: the query reading the selected `workspace`, else every workspace. */
export const pullRequestsScope = (workspace: string | null): string => (workspace !== null ? new URLSearchParams({ cwd: workspace }).toString() : "");

/** The open pull requests by scope, as {@link pullRequestsScope} builds it, which the sidebar and the Pull requests page share. */
export const pullRequestsStore = createPolledStore<PullRequestList>({
	// Keeps its name from before the page was called Pull requests, so the browser's cached list survives.
	url: (scope, fresh) => {
		const params = new URLSearchParams(scope ?? "");
		if (fresh) params.set("fresh", "");
		return `/api/pull-requests${params.size ? `?${params}` : ""}`;
	},
	cache: { key: "omp-agents.inbox-cache", decode: decodePullRequestList },
});

/**
 * Makes `change` on GitHub and answers the pull request as GitHub has it after. A state change or a review request shows
 * in `scope`'s list at once, so the rows and the details that read it agree, and the list is read again either way.
 */
export async function writePullRequest(scope: string, pr: PullRequest, change: PullRequestChange): Promise<PullRequestDetail> {
	const detail = await putJson<PullRequestDetail>("/api/pull-request", { owner: pr.owner, repo: pr.repo, number: pr.number, change } satisfies PullRequestEdit);
	if (change.field === "state") pullRequestsStore.update(list => withPullRequestState(list, pr, change.state, Date.now()), scope);
	if (change.field === "reviewer") {
		const avatarUrl = detail.reviewers.find(reviewer => reviewer.login === change.login)?.avatarUrl ?? null;
		pullRequestsStore.update(list => withPullRequestReviewers(list, pr, change.login, change.on, avatarUrl), scope);
	}
	void pullRequestsStore.refresh(scope, { fresh: true });
	return detail;
}

/** Marks one of `pr`'s files viewed by the viewer on GitHub, or not; no list shows it, so none is read again. */
export async function writeViewedFile(pr: PullRequest, path: string, on: boolean): Promise<void> {
	await putJson("/api/pull-request/viewed", { owner: pr.owner, repo: pr.repo, number: pr.number, path, on } satisfies PullRequestViewedEdit);
}

/**
 * Queues a merge, which the server makes at once when GitHub allows it, or cancels one. A pull request it merged on the
 * way shows as merged in `scope`'s list at once, as {@link writePullRequest} shows a state change, and the list is read again.
 */
export async function writeMergeQueue(scope: string, change: MergeQueueChange): Promise<MergeQueueAnswer> {
	const answer = await putJson<MergeQueueAnswer>("/api/merge-queue", change);
	if (answer.merged.length === 0) return answer;
	const at = Date.now();
	pullRequestsStore.update(list => answer.merged.reduce((changed, pr) => withPullRequestState(changed, pr, "merged", at), list), scope);
	void pullRequestsStore.refresh(scope, { fresh: true });
	return answer;
}

/** What every live session runs besides omp, in roster order, read every 5 seconds while a Browser has no address yet or shows its server menu. */
export const sessionProcessesStore = createPolledStore<LiveSessionProcesses[]>({ url: () => "/api/session-processes", pollMs: 5_000 });

/** Stops live session `instanceId`'s process `id`, and shows what every live session runs after. */
export async function writeProcessStop(instanceId: string, id: string): Promise<void> {
	const answer = await putJson<LiveSessionProcesses[]>("/api/session-processes/stop", { instanceId, id } satisfies ProcessStop);
	sessionProcessesStore.update(() => answer);
}

/** Starts live session `instanceId`'s dev server as a service it owns, and reads what every live session runs again once it started. */
export async function writeStartServer(instanceId: string): Promise<DevServerStart> {
	const answer = await putJson<DevServerStart>("/api/session-processes/start-server", { instanceId } satisfies DevServerRequest);
	if ("started" in answer) void sessionProcessesStore.refresh();
	return answer;
}

const NO_REPOS: RepoPullRequests[] = [];

/**
 * The pull requests the `@` menu and the command palette search: those of `scope`, a workspace or every one, as
 * {@link pullRequestsStore} keys them. That is the entry `App` polls; the unscoped read would ask GitHub about every repository.
 */
export function useSearchedPullRequests(scope: string): RepoPullRequests[] {
	return pullRequestsStore.use(scope).read?.data.repos ?? NO_REPOS;
}

const NO_HITS: ConversationHit[] = [];
/** How long typing must pause before the conversations are searched. */
const CONVERSATION_SEARCH_DELAY_MS = 200;

/**
 * The saved conversations whose prompts or replies hold every word of `query`, asked once typing pauses; none for a
 * blank query, until the answer for this very query arrives, or when the search fails.
 */
export function useConversationHits(query: string): ConversationHit[] {
	const [settled, setSettled] = useState(query);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(query), CONVERSATION_SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	}, [query]);
	const read = useRead<ConversationSearchAnswer>(query && settled === query ? `/api/conversations?q=${encodeURIComponent(query)}` : null);
	return read.data?.hits ?? NO_HITS;
}

export const analyticsStore = createPolledStore<Analytics>({
	url: range => `/api/analytics?range=${range ?? "24h"}`,
	cache: { key: "omp-agents.analytics-cache", decode: decodeAnalytics },
});

/** Settings › Activity's report over a range, `30d` by default. */
export const activityStore = createPolledStore<ActivityRead>({
	url: range => `/api/activity?range=${range ?? "30d"}`,
	cache: { key: "omp-agents.activity-cache", decode: decodeActivity },
});

/** The context sources of Settings › Analytics; the scope is the request's query (range, workspace, session), so reads stay in memory. */
export const contextStore = createPolledStore<ContextReport>({ url: scope => `/api/analytics/context?${scope ?? ""}` });

/** Where omp stands with each MCP integration, which the sidebar's tabs and the integrations page share. */
export const integrationsStore = createPolledStore<IntegrationsAnswer>({
	url: (_scope, fresh) => (fresh ? "/api/integrations?fresh" : "/api/integrations"),
	cache: { key: "omp-agents.integrations-cache", decode: decodeIntegrationsAnswer },
});

/** Every MCP server omp loads for you, for Settings › MCP servers; kept in memory only, as the providers' are. */
export const mcpServersStore = createPolledStore<McpServersAnswer>({ url: (_scope, fresh) => (fresh ? "/api/mcp-servers?fresh" : "/api/mcp-servers") });

/** The model providers omp signs in to and the sign-in Settings › Providers runs; kept in memory only, as it names your accounts. */
export const providersStore = createPolledStore<ProvidersAnswer>({ url: () => "/api/providers" });
