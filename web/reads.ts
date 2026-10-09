/** The server reads that components hold: one-off reads by URL, and the polled stores a sidebar list and its page share. */
import { useEffect, useMemo, useState } from "react";
import { isObject } from "../src/json";
import { type CalendarEventsAnswer, type GoogleStatus, type IntegrationsAnswer, MCP_INTEGRATIONS } from "../src/shared/accounts";
import { type Analytics, isAnalyticsRange } from "../src/shared/analytics";
import type { Inbox, RepoInbox } from "../src/shared/github";
import type { ModelEntry } from "../src/shared/models";
import type { TicketsAnswer } from "../src/shared/tickets";
import { errorText, getJson } from "./api";
import { createPolledStore } from "./polled-store";

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

/**
 * {@link useRead} whose answer a write can replace: `replace(answer)` shows the version that a save answered until a read
 * of the same `url` answers anew, and a failed read shows no error over it.
 */
export function useReplaceableRead<T>(url: string | null, version?: unknown): ReadState<T> & { replace: (answer: T) => void } {
	const read = useRead<T>(url, version);
	const [replaced, setReplaced] = useState<{ url: string | null; answered: T | null; answer: T } | null>(null);
	const shown = replaced?.url === url && replaced.answered === read.data ? replaced.answer : null;
	return { data: shown ?? read.data, error: shown ? null : read.error, replace: answer => setReplaced({ url, answered: read.data, answer }) };
}

/** The open pull requests by project `cwd`, which the sidebar and the inbox page share; `null` reads every project. */
export const inboxStore = createPolledStore<Inbox>({
	cacheKey: "omp-agents.inbox-cache",
	url: (cwd, fresh) => {
		const params = new URLSearchParams();
		if (cwd !== null) params.set("cwd", cwd);
		if (fresh) params.set("fresh", "");
		return `/api/inbox${params.size ? `?${params}` : ""}`;
	},
	isValid: (value): value is Inbox => {
		const inbox = value as Partial<Inbox> | null;
		// A read saved before the inbox carried each PR's diff size reads GitHub again.
		const current = (repo: RepoInbox): boolean => "error" in repo || repo.pullRequests.every(pr => typeof pr.additions === "number");
		return Array.isArray(inbox?.repos) && Array.isArray(inbox.unmatched) && inbox.repos.every(current);
	},
});

/** The Linear issues assigned to you, which the sidebar and the tickets page share; Linear is not per project, so there is one entry. */
export const ticketsStore = createPolledStore<TicketsAnswer>({
	cacheKey: "omp-agents.tickets-cache",
	url: (_, fresh) => `/api/tickets${fresh ? "?fresh" : ""}`,
	isValid: (value): value is TicketsAnswer => {
		const answer = value as Partial<TicketsAnswer> | null;
		// A read saved before tickets carried their opening date reads Linear again.
		return Array.isArray(answer?.tickets) && answer.tickets.every(ticket => typeof ticket.createdAt === "string");
	},
});

export const analyticsStore = createPolledStore<Analytics>({
	cacheKey: "omp-agents.analytics-cache",
	url: range => `/api/analytics?range=${range ?? "24h"}`,
	isValid: (value): value is Analytics => {
		const numbers = (item: unknown, fields: string[]): boolean =>
			isObject(item) && fields.every(field => typeof item[field] === "number");
		const usage = (item: unknown): boolean =>
			isObject(item) && numbers(item, ["requests", "failed", "cost", "cacheRate"])
			&& numbers(item.tokens, ["input", "output", "cacheRead", "cacheWrite", "total"]);
		const provider = (item: unknown): boolean =>
			isObject(item) && typeof item.provider === "string" && numbers(item, ["tokens", "cost", "requests"]);
		if (!isObject(value) || typeof value.range !== "string" || !isAnalyticsRange(value.range)) return false;
		const { sync } = value;
		return isObject(sync) && typeof sync.phase === "string" && ["idle", "syncing", "error"].includes(sync.phase)
			&& numbers(sync, ["current", "total"]) && (sync.lastSyncedAt === null || typeof sync.lastSyncedAt === "number")
			&& (sync.error === null || typeof sync.error === "string")
			&& usage(value.totals) && numbers(value.agents, ["main", "subagent", "advisor"])
			&& Array.isArray(value.providers) && value.providers.every(provider)
			&& Array.isArray(value.series) && value.series.every(bucket =>
				isObject(bucket) && numbers(bucket, ["start", "tokens", "cost", "requests"])
				&& Array.isArray(bucket.providers) && bucket.providers.every(provider))
			&& Array.isArray(value.models) && value.models.every(model =>
				isObject(model) && typeof model.selector === "string" && usage(model)
				&& (model.tokensPerSecond === null || typeof model.tokensPerSecond === "number"))
			&& Array.isArray(value.projects) && value.projects.every(project =>
				isObject(project) && typeof project.cwd === "string" && usage(project))
			&& Array.isArray(value.tools) && value.tools.every(tool =>
				isObject(tool) && typeof tool.name === "string" && numbers(tool, ["calls", "errors", "tokenShare"]))
			&& Array.isArray(value.sessions) && value.sessions.every(session =>
				isObject(session) && typeof session.sessionId === "string" && typeof session.cwd === "string"
				&& (session.title === null || typeof session.title === "string") && typeof session.listed === "boolean"
				&& usage(session.usage) && numbers(session, ["subagentTokens", "lastAt"])
				&& Array.isArray(session.models) && session.models.every(model => typeof model === "string"));
	},
});

/** Where omp stands with each MCP integration, which the sidebar's tabs, the tickets page, and the integrations page share. */
export const integrationsStore = createPolledStore<IntegrationsAnswer>({
	cacheKey: "omp-agents.integrations-cache",
	url: (_scope, fresh) => (fresh ? "/api/integrations?fresh" : "/api/integrations"),
	isValid: (value): value is IntegrationsAnswer => {
		const integrations = isObject(value) ? value.integrations : null;
		return isObject(integrations) && MCP_INTEGRATIONS.every(id => isObject(integrations[id]));
	},
});

/** The calendars checked in your Google Calendar's list, which the Calendar page reads unless you unchecked one in its sidebar. */
export const googleStore = createPolledStore<GoogleStatus>({
	cacheKey: "omp-agents.google-cache",
	url: (_, fresh) => `/api/google${fresh ? "?fresh" : ""}`,
	// A read an older version kept has no `shown`, which would show every calendar unchecked until the first poll.
	isValid: (value): value is GoogleStatus => {
		const calendars = isObject(value) ? value.calendars : null;
		return Array.isArray(calendars) && calendars.every(calendar => isObject(calendar) && typeof calendar.shown === "boolean");
	},
});

/** Your Google events over a span, by its `from` and `to` query, which the Calendar page reads a month at a time. */
export const calendarEventsStore = createPolledStore<CalendarEventsAnswer>({
	cacheKey: "omp-agents.calendar-events-cache",
	url: (span, fresh) => `/api/calendar/events?${span}${fresh ? "&fresh" : ""}`,
	isValid: (value): value is CalendarEventsAnswer => Array.isArray((value as Partial<CalendarEventsAnswer> | null)?.events),
});

/** The {@link calendarEventsStore} scope of the month of `year` and `month` (0 for January), from its first local midnight to the next month's. */
export const monthSpan = (year: number, month: number): string =>
	new URLSearchParams({ from: new Date(year, month, 1).toISOString(), to: new Date(year, month + 1, 1).toISOString() }).toString();
