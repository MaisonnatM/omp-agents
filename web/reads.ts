/** The server reads that components hold: one-off reads by URL, and the polled stores a sidebar list and its page share. */
import { useEffect, useState } from "react";
import { isObject } from "../src/json";
import type { CalendarEventsAnswer, GoogleStatus, IntegrationsAnswer, McpIntegration, McpIntegrationId } from "../src/shared/accounts";
import type { Inbox } from "../src/shared/github";
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

/**
 * The server's answer at `url`, nothing while `url` is `null` or until it first answers for `url`, so an answer for a
 * previous `url` never shows. A change of `version` reads it again, keeping the last answer meanwhile and when that read fails.
 */
export function useRead<T>(url: string | null, version?: unknown): ReadState<T> {
	const [read, setRead] = useState<(ReadState<T> & { url: string }) | null>(null);
	useEffect(() => {
		if (url === null) return;
		const controller = new AbortController();
		// An abort makes `getJson` reject, so only the failure needs to tell it apart.
		getJson<T>(url, controller.signal).then(
			data => setRead({ url, data, error: null }),
			(err: unknown) => {
				if (!controller.signal.aborted) setRead(last => ({ url, data: last?.url === url ? last.data : null, error: errorText(err) }));
			},
		);
		return () => controller.abort();
	}, [url, version]);
	return read?.url === url ? read : UNREAD;
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
		return Array.isArray(inbox?.repos) && Array.isArray(inbox.unmatched);
	},
});

/** The Linear issues assigned to you, which the sidebar and the tickets page share; Linear is not per project, so there is one entry. */
export const ticketsStore = createPolledStore<TicketsAnswer>({
	cacheKey: "omp-agents.tickets-cache",
	url: (_, fresh) => `/api/tickets${fresh ? "?fresh" : ""}`,
	isValid: (value): value is TicketsAnswer => Array.isArray((value as Partial<TicketsAnswer> | null)?.tickets),
});

/** Where omp stands with each MCP integration, which the sidebar's tabs, the tickets page, and the integrations page share. */
export const integrationsStore = createPolledStore<IntegrationsAnswer>({
	cacheKey: "omp-agents.integrations-cache",
	url: (_scope, fresh) => (fresh ? "/api/integrations?fresh" : "/api/integrations"),
	isValid: (value): value is IntegrationsAnswer => isObject(value) && Array.isArray(value.integrations),
});

/** `id`'s integration as `integrationsStore` last read it, `null` until it has. */
export const findIntegration = (answer: IntegrationsAnswer | undefined, id: McpIntegrationId): McpIntegration | null =>
	answer?.integrations.find(integration => integration.id === id) ?? null;

/** The Google OAuth client and whether its sign-in can read your calendars. */
export const googleStore = createPolledStore<GoogleStatus>({
	cacheKey: "omp-agents.google-cache",
	url: () => "/api/google",
	isValid: (value): value is GoogleStatus => typeof (value as Partial<GoogleStatus> | null)?.connected === "boolean",
});

/** Your Google events over a span, by its `from` and `to` query, which the Calendar page reads a month at a time. */
export const calendarEventsStore = createPolledStore<CalendarEventsAnswer>({
	cacheKey: "omp-agents.calendar-events-cache",
	url: (span, fresh) => `/api/calendar/events?${span}${fresh ? "&fresh" : ""}`,
	isValid: (value): value is CalendarEventsAnswer => Array.isArray((value as Partial<CalendarEventsAnswer> | null)?.events),
});
