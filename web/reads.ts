/** The server reads that components hold: one-off reads by URL, and the polled stores a sidebar list and its page share. */
import { useEffect, useMemo, useRef, useState } from "react";
import { callable, decodeIntegrationsAnswer, type IntegrationsAnswer, type McpIntegration } from "../src/shared/accounts";
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
import { type Analytics, decodeAnalytics } from "../src/shared/analytics";
import { decodePullRequestList, type PullRequestList, type RepoPullRequests } from "../src/shared/github";
import type { ModelEntry } from "../src/shared/models";
import type { ConversationHit, ConversationSearchAnswer } from "../src/shared/sessions";
import { decodeTicketsAnswer, type Ticket, type TicketsAnswer } from "../src/shared/tickets";
import type { ProvidersAnswer } from "../src/shared/providers";
import type { McpServersAnswer } from "../src/shared/mcp-servers";
import { errorText, getJson } from "./api";
import { createPolledStore, type PolledEntry } from "./polled-store";

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
 * What the `@` menu offers from your inbox and calendars: the inbox's latest conversations while `mailWanted` and
 * Gmail is callable, and the events from today's midnight over the next {@link MENTION_EVENT_DAYS} days while
 * `eventsWanted`, earliest first: Google's while Google Calendar is callable, and this computer's.
 */
export function useMailAndEvents(mailWanted: boolean, eventsWanted: boolean): { threads: MailThread[]; events: MentionEvent[] } {
	const integrations = integrationsStore.usePolling().read?.data.integrations;
	const gmail = integrations?.gmail.connection;
	const google = integrations?.["google-calendar"].connection;
	const threads = gmailStore.usePolling(null, mailWanted && gmail !== undefined && callable(gmail)).read?.data.threads;
	const now = new Date();
	const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + MENTION_EVENT_DAYS).getTime();
	const span = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }).toString();
	const googleEvents = calendarEventsStore.usePolling(span, eventsWanted && google !== undefined && callable(google)).read?.data.events;
	const localEvents = localEventsStore.usePolling(null, eventsWanted).read?.data.events;
	const events = useMemo(
		() =>
			eventsWanted
				? [
						...(googleEvents ?? []).map(({ title, when, calendar, url }) => ({ title, when, calendar, url })),
						...(localEvents ?? []).map(({ title, when }) => ({ title, when, calendar: "This computer", url: null })),
					]
						.filter(({ when }) => startOf(when) < to && endOf(when) > from)
						.sort((a, b) => startOf(a.when) - startOf(b.when))
				: [],
		[eventsWanted, googleEvents, localEvents, from, to],
	);
	return { threads: (mailWanted && threads) || NO_THREADS, events };
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

/** Where omp stands with each MCP integration, which the sidebar's tabs, the tickets page, and the integrations page share. */
export const integrationsStore = createPolledStore<IntegrationsAnswer>({
	url: (_scope, fresh) => (fresh ? "/api/integrations?fresh" : "/api/integrations"),
	cache: { key: "omp-agents.integrations-cache", decode: decodeIntegrationsAnswer },
});

/** Every MCP server omp loads for you, for Settings › MCP servers; kept in memory only, as the providers' are. */
export const mcpServersStore = createPolledStore<McpServersAnswer>({ url: (_scope, fresh) => (fresh ? "/api/mcp-servers?fresh" : "/api/mcp-servers") });

/** The model providers omp signs in to and the sign-in Settings › Providers runs; kept in memory only, as it names your accounts. */
export const providersStore = createPolledStore<ProvidersAnswer>({ url: () => "/api/providers" });

/** The calendars checked in your Google Calendar's list, which the Calendar page reads unless you unchecked one in its sidebar. */
export const googleStore = createPolledStore<GoogleStatus>({
	url: (_, fresh) => `/api/google${fresh ? "?fresh" : ""}`,
	cache: { key: "omp-agents.google-cache", decode: decodeGoogleStatus },
});

/** Your Google events over a span, by its `from` and `to` query, which the Calendar page reads a month at a time. */
export const calendarEventsStore = createPolledStore<CalendarEventsAnswer>({
	url: (span, fresh) => `/api/calendar/events?${span}${fresh ? "&fresh" : ""}`,
	cache: { key: "omp-agents.calendar-events-cache", decode: decodeCalendarEventsAnswer },
});

/**
 * Whether the dashboard can call Google Calendar, and the calendars checked in your Google Calendar's list, read every
 * minute while it can; `calendars` is `null` while it cannot or before the first read.
 */
export function useGoogleCalendars(): { connected: boolean; calendars: GoogleCalendar[] | null } {
	const connection = integrationsStore.usePolling().read?.data.integrations["google-calendar"].connection;
	const connected = connection !== undefined && callable(connection);
	const calendars = googleStore.usePolling(null, connected).read?.data.calendars ?? null;
	return { connected, calendars: connected ? calendars : null };
}

/** Your Gmail inbox's latest conversations, which the Inbox page and its sidebar tab share. */
export const gmailStore = createPolledStore<InboxAnswer>({
	url: (_, fresh) => `/api/gmail/inbox${fresh ? "?fresh" : ""}`,
	cache: { key: "omp-agents.gmail-cache", decode: decodeInboxAnswer },
});

/** Gmail's integration, `null` before the first read, and your inbox with its unread conversations, read every minute while the dashboard can call Gmail. */
export function useGmailInbox(): { gmail: McpIntegration<"gmail"> | null; inbox: PolledEntry<InboxAnswer>; unread: number } {
	const gmail = integrationsStore.usePolling().read?.data.integrations.gmail ?? null;
	const inbox = gmailStore.usePolling(null, gmail !== null && callable(gmail.connection));
	const unread = inbox.read?.data.threads.filter(thread => thread.unread).length ?? 0;
	return { gmail, inbox, unread };
}

/** The conversations read since the page loaded, by thread id, in memory only: unlike the inbox's list, their bodies are large and private. */
export const mailThreadStore = createPolledStore<ThreadAnswer>({
	url: (id, fresh) => `/api/gmail/thread?${new URLSearchParams({ id: id ?? "" })}${fresh ? "&fresh" : ""}`,
});

/** A thread read: the last answer, whether the latest attempt failed, and whether one is in flight. */
export type MailThreadRead = PolledEntry<ThreadAnswer>;

/**
 * Conversation `id`, read the first time it is asked for, and again from Gmail once `arrived`, when its last message
 * arrived as the inbox lists it, is later than that read: a reply came since.
 */
export function useMailThread(id: string, arrived: number | null): MailThreadRead {
	const entry = mailThreadStore.use(id);
	const entryRef = useRef(entry);
	entryRef.current = entry;
	useEffect(() => {
		const current = entryRef.current;
		if (current.read === null) mailThreadStore.ensure(id);
		else if (arrived !== null && current.read.at < arrived) void mailThreadStore.refresh(id, { fresh: true });
	}, [id, arrived]);
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
