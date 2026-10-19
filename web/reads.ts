/** The server reads that components hold: one-off reads by URL, and the polled stores a sidebar list and its page share. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type AccountId,
	anyCallable,
	decodeIntegrationsAnswer,
	type GoogleAccount,
	type IntegrationsAnswer,
	type McpIntegration,
	visibleAccounts,
} from "../src/shared/accounts";
import {
	type CalendarEventsAnswer,
	decodeCalendarEventsAnswer,
	decodeGoogleStatus,
	decodeLocalEventsAnswer,
	type EventWhen,
	type GoogleCalendar,
	type GoogleStatus,
	type LocalEventsAnswer,
} from "../src/shared/calendar";
import { decodeInboxAnswer, type InboxAnswer, type MailThread, type ThreadAnswer } from "../src/shared/gmail";
import { type Analytics, type ContextReport, decodeAnalytics } from "../src/shared/analytics";
import { decodePullRequestList, type PullRequest, type PullRequestChange, type PullRequestDetail, type PullRequestEdit, type PullRequestList, type RepoPullRequests } from "../src/shared/github";
import type { MergeQueueAnswer, MergeQueueChange } from "../src/shared/merge-queue";
import type { ModelEntry } from "../src/shared/models";
import type { ConversationHit, ConversationSearchAnswer } from "../src/shared/sessions";
import { decodeTicketsAnswer, type Ticket, type TicketsAnswer } from "../src/shared/tickets";
import type { ProvidersAnswer } from "../src/shared/providers";
import type { McpServersAnswer } from "../src/shared/mcp-servers";
import { errorText, getJson, putJson } from "./api";
import { createPolledStore, type PolledEntry } from "./polled-store";
import { withPullRequestState } from "./pull-requests-model";
import { pickedInbox } from "./inbox-model";
import { useStoredState } from "./stored-state";

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

/** The open pull requests by workspace `cwd`, which the sidebar and the Pull requests page share; `null` reads every workspace. */
export const pullRequestsStore = createPolledStore<PullRequestList>({
	// Keeps its name from before the page was called Pull requests, so the browser's cached list survives.
	url: (cwd, fresh) => {
		const params = new URLSearchParams();
		if (cwd !== null) params.set("cwd", cwd);
		if (fresh) params.set("fresh", "");
		return `/api/pull-requests${params.size ? `?${params}` : ""}`;
	},
	cache: { key: "omp-agents.inbox-cache", decode: decodePullRequestList },
});

/**
 * Makes `change` on GitHub and answers the pull request as GitHub has it after. A state change shows in `workspace`'s
 * list at once, so the rows and the details that read it agree, and the list is read again either way.
 */
export async function writePullRequest(workspace: string | null, pr: PullRequest, change: PullRequestChange): Promise<PullRequestDetail> {
	const detail = await putJson<PullRequestDetail>("/api/pull-request", { owner: pr.owner, repo: pr.repo, number: pr.number, change } satisfies PullRequestEdit);
	if (change.field === "state") pullRequestsStore.update(list => withPullRequestState(list, pr, change.state, Date.now()), workspace);
	void pullRequestsStore.refresh(workspace, { fresh: true });
	return detail;
}

/**
 * Queues a merge, which the server makes at once when GitHub allows it, or cancels one. A pull request it merged on the
 * way shows as merged in `workspace`'s list at once, as {@link writePullRequest} shows a state change, and the list is read again.
 */
export async function writeMergeQueue(workspace: string | null, change: MergeQueueChange): Promise<MergeQueueAnswer> {
	const answer = await putJson<MergeQueueAnswer>("/api/merge-queue", change);
	if (answer.merged.length === 0) return answer;
	const at = Date.now();
	pullRequestsStore.update(list => answer.merged.reduce((changed, pr) => withPullRequestState(changed, pr, "merged", at), list), workspace);
	void pullRequestsStore.refresh(workspace, { fresh: true });
	return answer;
}

/** The Linear issues assigned to you, which the sidebar and the tickets page share; Linear is not per workspace, so there is one entry. */
export const ticketsStore = createPolledStore<TicketsAnswer>({
	url: (_, fresh) => `/api/tickets${fresh ? "?fresh" : ""}`,
	cache: { key: "omp-agents.tickets-cache", decode: decodeTicketsAnswer },
});

const NO_TICKETS: Ticket[] = [];
const NO_REPOS: RepoPullRequests[] = [];

/**
 * What the `@` menu and the command palette search besides the page's lists: the Linear issues assigned to you, read
 * only while `ticketsWanted`, and the pull requests of workspace `scope`. That is the entry `App` polls; the unscoped
 * read would ask GitHub about every repository.
 */
export function useSearchSources(ticketsWanted: boolean, scope: string | null): { tickets: Ticket[]; pullRequestRepos: RepoPullRequests[] } {
	const tickets = ticketsStore.usePolling(null, ticketsWanted).read?.data.tickets;
	const pullRequestRepos = pullRequestsStore.use(scope).read?.data.repos ?? NO_REPOS;
	return { tickets: (ticketsWanted && tickets) || NO_TICKETS, pullRequestRepos };
}

const NO_THREADS: MailThread[] = [];
const NO_ACCOUNTS: GoogleAccount[] = [];
/** How many days from today's midnight the `@` menu lists events of. */
const MENTION_EVENT_DAYS = 14;

/** An event the `@` menu offers: a Google one carries its link, one kept on this computer has none. */
export interface MentionEvent {
	title: string;
	when: EventWhen;
	calendar: string;
	url: string | null;
}

const startOf = (when: EventWhen): number => (when.allDay ? new Date(`${when.firstDay}T00:00`).getTime() : when.start);
const endOf = (when: EventWhen): number => (when.allDay ? new Date(`${when.lastDay}T00:00`).getTime() + 86_400_000 : when.end);

/**
 * What the `@` menu offers from your inbox and calendars, of the accounts `workspace` shows: the inbox's latest
 * conversations while `mailWanted` and Gmail is callable, and the events from today's midnight over the next
 * {@link MENTION_EVENT_DAYS} days while `eventsWanted`, earliest first: Google's while Google Calendar is callable, and this computer's.
 */
export function useMailAndEvents(mailWanted: boolean, eventsWanted: boolean, workspace: string | null): { threads: MailThread[]; events: MentionEvent[] } {
	const integrations = integrationsStore.usePolling().read?.data.integrations;
	const mailAccounts = integrations?.gmail.accounts ?? NO_ACCOUNTS;
	const calendarAccounts = integrations?.["google-calendar"].accounts ?? NO_ACCOUNTS;
	const threads = gmailStore.usePolling(null, mailWanted && anyCallable(mailAccounts)).read?.data.threads;
	const now = new Date();
	const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + MENTION_EVENT_DAYS).getTime();
	const span = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }).toString();
	const googleEvents = calendarEventsStore.usePolling(span, eventsWanted && anyCallable(calendarAccounts)).read?.data.events;
	const localEvents = localEventsStore.usePolling(null, eventsWanted).read?.data.events;
	const shownMail = useMemo(() => visibleAccounts(mailAccounts, workspace), [mailAccounts, workspace]);
	const shownCalendars = useMemo(() => visibleAccounts(calendarAccounts, workspace), [calendarAccounts, workspace]);
	const events = useMemo(
		() =>
			eventsWanted
				? [
						...(googleEvents ?? []).filter(event => shownCalendars.has(event.account)).map(({ title, when, calendar, url }) => ({ title, when, calendar, url })),
						...(localEvents ?? []).map(({ title, when }) => ({ title, when, calendar: "This computer", url: null })),
					]
						.filter(({ when }) => startOf(when) < to && endOf(when) > from)
						.sort((a, b) => startOf(a.when) - startOf(b.when))
				: [],
		[eventsWanted, googleEvents, localEvents, shownCalendars, from, to],
	);
	const shownThreads = useMemo(() => (threads ?? NO_THREADS).filter(thread => shownMail.has(thread.account)), [threads, shownMail]);
	return { threads: mailWanted ? shownThreads : NO_THREADS, events };
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

/** The context sources of Settings › Analytics; the scope is the request's query (range, workspace, session), so reads stay in memory. */
export const contextStore = createPolledStore<ContextReport>({ url: scope => `/api/analytics/context?${scope ?? ""}` });

/** Where omp stands with each MCP integration, which the sidebar's tabs, the tickets page, and the integrations page share. */
export const integrationsStore = createPolledStore<IntegrationsAnswer>({
	url: (_scope, fresh) => (fresh ? "/api/integrations?fresh" : "/api/integrations"),
	cache: { key: "omp-agents.integrations-cache", decode: decodeIntegrationsAnswer },
});

/** Every MCP server omp loads for you, for Settings › MCP servers; kept in memory only, as the providers' are. */
export const mcpServersStore = createPolledStore<McpServersAnswer>({ url: (_scope, fresh) => (fresh ? "/api/mcp-servers?fresh" : "/api/mcp-servers") });

/** The model providers omp signs in to and the sign-in Settings › Providers runs; kept in memory only, as it names your accounts. */
export const providersStore = createPolledStore<ProvidersAnswer>({ url: () => "/api/providers" });

/** The calendars checked in each account's Google Calendar list, which the Calendar page reads unless you unchecked one in its sidebar. */
export const googleStore = createPolledStore<GoogleStatus>({
	url: (_, fresh) => `/api/google${fresh ? "?fresh" : ""}`,
	cache: { key: "omp-agents.google-cache", decode: decodeGoogleStatus },
});

/** Every account's Google events over a span, by its `from` and `to` query, which the Calendar page reads a month at a time. */
export const calendarEventsStore = createPolledStore<CalendarEventsAnswer>({
	url: (span, fresh) => `/api/calendar/events?${span}${fresh ? "&fresh" : ""}`,
	cache: { key: "omp-agents.calendar-events-cache", decode: decodeCalendarEventsAnswer },
});

/** The Google Calendar accounts a page in a workspace reads, and their calendars. */
export interface GoogleCalendars {
	/** Whether the dashboard can call any Google Calendar account. */
	connected: boolean;
	/** The Google Calendar accounts `workspace` shows. */
	accounts: GoogleAccount[];
	/** The calendars of those accounts, read every minute while one is callable; `null` while none is or before the first read. */
	calendars: GoogleCalendar[] | null;
}

/** The Google Calendar accounts `workspace` shows, `null` for all workspaces, and their calendars. */
export function useGoogleCalendars(workspace: string | null): GoogleCalendars {
	const all = integrationsStore.usePolling().read?.data.integrations["google-calendar"].accounts ?? NO_ACCOUNTS;
	const connected = anyCallable(all);
	const read = googleStore.usePolling(null, connected).read?.data.calendars ?? null;
	return useMemo(() => {
		const shown = visibleAccounts(all, workspace);
		return { connected, accounts: all.filter(account => shown.has(account.name)), calendars: connected && read ? read.filter(calendar => shown.has(calendar.account)) : null };
	}, [all, connected, read, workspace]);
}

/** Every signed-in Gmail account's inbox, merged, which the Inbox page and its sidebar tab share. */
export const gmailStore = createPolledStore<InboxAnswer>({
	url: (_, fresh) => `/api/gmail/inbox${fresh ? "?fresh" : ""}`,
	cache: { key: "omp-agents.gmail-cache", decode: decodeInboxAnswer },
});

/** The Gmail account the Inbox's picker narrows to; absent for every account. */
const INBOX_ACCOUNT_KEY = "omp-agents.gmail-account";

const decodeAccount = (raw: string | null): AccountId | null => raw || null;
const encodeAccount = (account: AccountId | null): string => account ?? "";

/** The Inbox as a workspace shows it. */
export interface GmailInbox {
	/** Gmail's integration, `null` before the first read. */
	gmail: McpIntegration<"gmail"> | null;
	inbox: PolledEntry<InboxAnswer>;
	/** The Gmail accounts the workspace shows. */
	accounts: GoogleAccount[];
	/** The account the picker narrows to, as {@link pickedInbox} reads the stored choice; `null` for every shown account. */
	picked: AccountId | null;
	/** Stores the picker's choice, or what `next` makes of the stored one, `null` for every account. */
	pick: (next: AccountId | null | ((stored: AccountId | null) => AccountId | null)) => void;
	/** The conversations of every shown account, newest first, whatever the picker narrows to. */
	threads: MailThread[];
}

/** The inboxes of the Gmail accounts `workspace` shows, `null` for all workspaces, read every minute while one is callable, and the Inbox's account picker. */
export function useGmailInbox(workspace: string | null): GmailInbox {
	const gmail = integrationsStore.usePolling().read?.data.integrations.gmail ?? null;
	const all = gmail?.accounts ?? NO_ACCOUNTS;
	const inbox = gmailStore.usePolling(null, anyCallable(all));
	const [stored, pick] = useStoredState(INBOX_ACCOUNT_KEY, decodeAccount, encodeAccount);
	const listed = inbox.read?.data.threads;
	return useMemo(() => {
		const shown = visibleAccounts(all, workspace);
		const accounts = all.filter(account => shown.has(account.name));
		const threads = (listed ?? NO_THREADS).filter(thread => shown.has(thread.account));
		return { gmail, inbox, accounts, picked: pickedInbox(stored, accounts), pick, threads };
	}, [gmail, all, inbox, stored, pick, listed, workspace]);
}

/** The {@link mailThreadStore} scope of conversation `id` of Gmail account `account`. */
export const mailThreadScope = (account: AccountId, id: string): string => new URLSearchParams({ account, id }).toString();

/** The conversations read since the page loaded, by {@link mailThreadScope}, in memory only: unlike the inbox's list, their bodies are large and private. */
export const mailThreadStore = createPolledStore<ThreadAnswer>({
	url: (scope, fresh) => `/api/gmail/thread?${scope ?? ""}${fresh ? "&fresh" : ""}`,
});

/** A thread read: the last answer, whether the latest attempt failed, and whether one is in flight. */
export type MailThreadRead = PolledEntry<ThreadAnswer>;

/**
 * Conversation `id` of Gmail account `account`, read the first time it is asked for, and again from Gmail once
 * `arrived`, when its last message arrived as the inbox lists it, is later than that read: a reply came since.
 */
export function useMailThread(account: AccountId, id: string, arrived: number | null): MailThreadRead {
	const scope = mailThreadScope(account, id);
	const entry = mailThreadStore.use(scope);
	const entryRef = useRef(entry);
	entryRef.current = entry;
	useEffect(() => {
		const current = entryRef.current;
		if (current.read === null) mailThreadStore.ensure(scope);
		else if (arrived !== null && current.read.at < arrived) void mailThreadStore.refresh(scope, { fresh: true });
	}, [scope, arrived]);
	return entry;
}

/** Every event kept on this computer, which the Calendar page reads with or without Google Calendar. */
export const localEventsStore = createPolledStore<LocalEventsAnswer>({
	url: () => "/api/calendar/local",
	cache: { key: "omp-agents.local-events-cache", decode: decodeLocalEventsAnswer },
});

/** The {@link calendarEventsStore} scope of the month of `year` and `month` (0 for January), from its first local midnight to the next month's. */
export const monthSpan = (year: number, month: number): string =>
	new URLSearchParams({ from: new Date(year, month, 1).toISOString(), to: new Date(year, month + 1, 1).toISOString() }).toString();
