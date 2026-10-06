/**
 * Google Calendar, read-only: the OAuth client you save in the settings, the sign-in that gives the server a refresh
 * token, and the events of the calendars Google Calendar shows you, which the Calendar page lists.
 * The sign-in is Google's loopback flow for desktop clients: a one-off listener on 127.0.0.1 receives Google's redirect.
 */
import { createHash, randomBytes } from "node:crypto";
import { createCache } from "./cache";
import { JsonFile } from "./fs";
import { isObject, nonEmptyStr, str } from "./json";
import type { CalendarEvent, CalendarEventsAnswer, GoogleClient, GoogleStatus } from "./shared/accounts";
import { createSignIn } from "./sign-in";
import { isDay } from "./user-todos-parse";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_URL = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** An access token this close to its expiry is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000;
const DAY_MS = 86_400_000;

interface Stored extends GoogleClient {
	/** `null` until a sign-in succeeds, and again once Google refuses it. */
	refreshToken: string | null;
}

function parseStored(json: unknown): Stored | null {
	if (!isObject(json)) return null;
	const clientId = nonEmptyStr(json.clientId);
	const clientSecret = nonEmptyStr(json.clientSecret);
	const refreshToken = json.refreshToken === null ? null : nonEmptyStr(json.refreshToken);
	return clientId && clientSecret && refreshToken !== undefined ? { clientId, clientSecret, refreshToken } : null;
}

/** The day before `day`, both `YYYY-MM-DD`. */
const dayBefore = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/** The calendar an event belongs to, as Google's calendar list describes it. */
export interface CalendarInfo {
	id: string;
	name: string;
	color: string;
}

/** `item` of Google's calendar list, or `null` for one Google Calendar does not show you. */
export function toCalendarInfo(item: unknown): CalendarInfo | null {
	if (!isObject(item) || item.selected !== true || item.hidden === true) return null;
	const id = nonEmptyStr(item.id);
	return id ? { id, name: str(item.summaryOverride) ?? str(item.summary) ?? id, color: str(item.backgroundColor) ?? "#039be5" } : null;
}

/**
 * `item` of a calendar's event list as the page shows it, or `null` for one Google Calendar hides by default: canceled,
 * declined, or a working location, which Google shows apart from the events. Google ends an all-day event on the day after it.
 */
export function toCalendarEvent(item: unknown, calendar: CalendarInfo): CalendarEvent | null {
	if (!isObject(item) || !isObject(item.start) || !isObject(item.end)) return null;
	const id = nonEmptyStr(item.id);
	if (!id || item.status === "cancelled" || item.eventType === "workingLocation") return null;
	const declined = Array.isArray(item.attendees) && item.attendees.some(attendee => isObject(attendee) && attendee.self === true && attendee.responseStatus === "declined");
	if (declined) return null;
	const htmlLink = str(item.htmlLink);
	const event = {
		id: `${calendar.id}/${id}`,
		title: nonEmptyStr(item.summary) ?? "(No title)",
		calendar: calendar.name,
		color: calendar.color,
		url: htmlLink?.startsWith("https://") ? htmlLink : "https://calendar.google.com/",
	};
	const firstDay = item.start.date;
	const endDay = item.end.date;
	if (isDay(firstDay) && isDay(endDay)) {
		const lastDay = dayBefore(endDay);
		return { ...event, when: { allDay: true, firstDay, lastDay: lastDay < firstDay ? firstDay : lastDay } };
	}
	const start = Date.parse(str(item.start.dateTime) ?? "");
	const end = Date.parse(str(item.end.dateTime) ?? "");
	return Number.isFinite(start) && Number.isFinite(end) && end > start ? { ...event, when: { allDay: false, start, end } } : null;
}

/** Why Google refused a request: its own message when it gives one. */
async function refusal(response: Response): Promise<string> {
	const body: unknown = await response.json().catch(() => null);
	const error = isObject(body) ? body.error : null;
	const message = isObject(error) ? str(error.message) : str(error);
	const description = isObject(body) ? str(body.error_description) : undefined;
	if (!message) return `Google answered ${response.status}`;
	return description ? `${message}: ${description}` : message;
}

const NOT_CONNECTED = "Google Calendar is not connected. Connect it on the Integrations page.";

/** The Google connection the settings set up, kept in `path` with the owner's permissions only, since it holds a secret. */
export class GoogleCalendar {
	readonly #file: JsonFile<Stored>;
	#stored: Stored | null;
	#access: { token: string; expiresAt: number } | null = null;
	readonly #signIn = createSignIn("Google's sign-in page was not completed within 5 minutes. Try again.");
	readonly #events = createCache<CalendarEventsAnswer>(60_000);

	constructor(path: string) {
		this.#file = new JsonFile(path, { parse: parseStored, holds: "a Google OAuth client", onInvalid: "aside", indent: "\t", mode: 0o600 });
		this.#stored = this.#file.load();
	}

	status(): GoogleStatus {
		return { clientId: this.#stored?.clientId ?? null, connected: Boolean(this.#stored?.refreshToken), signIn: this.#signIn.state() };
	}

	/** Replaces the OAuth client, which signs out: a refresh token belongs to the client that obtained it. */
	saveClient(client: GoogleClient): GoogleStatus {
		this.#signIn.cancel();
		this.#store({ ...client, refreshToken: null });
		return this.status();
	}

	/** Keeps `stored`, and drops the access token and the events read with the last one. */
	#store(stored: Stored): void {
		this.#stored = stored;
		this.#access = null;
		this.#events.dropWhere(() => true);
		this.#file.save(stored);
	}

	/**
	 * Starts a sign-in, abandoning any under way, and answers once it has Google's authorization address to open.
	 * The listener that receives Google's redirect stops when the sign-in ends, fails, or is replaced.
	 */
	async startSignIn(): Promise<GoogleStatus> {
		const stored = this.#stored;
		if (!stored) throw new Error("Save an OAuth client first.");
		await this.#signIn.start(async (signal, waiting) => {
			const verifier = randomBytes(32).toString("base64url");
			const state = randomBytes(16).toString("base64url");
			const code = Promise.withResolvers<string>();
			const listener = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch(req) {
					const params = new URL(req.url).searchParams;
					if (params.get("state") !== state) return new Response("This is not the sign-in the dashboard started.", { status: 400 });
					const granted = params.get("code");
					if (granted) code.resolve(granted);
					else code.reject(new Error(`Google refused the sign-in: ${params.get("error") ?? "no code"}`));
					const text = granted ? "Authorization received. Check the dashboard for the connection result, then close this tab." : "The sign-in was refused. You can close this tab.";
					return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
				},
			});
			try {
				const redirectUri = `http://127.0.0.1:${listener.port}`;
				signal.addEventListener("abort", () => code.reject(signal.reason), { once: true });
				const url = new URL(AUTH_URL);
				url.search = new URLSearchParams({
					client_id: stored.clientId,
					redirect_uri: redirectUri,
					response_type: "code",
					scope: SCOPE,
					access_type: "offline",
					prompt: "consent",
					state,
					code_challenge: createHash("sha256").update(verifier).digest("base64url"),
					code_challenge_method: "S256",
				}).toString();
				waiting(url.href);
				const tokens = await this.#token({ code: await code.promise, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }, stored, signal);
				const refreshToken = str(tokens.refresh_token);
				if (!refreshToken) throw new Error("Google gave no refresh token. Remove the dashboard's access in your Google account, then sign in again.");
				signal.throwIfAborted();
				this.#store({ ...stored, refreshToken });
			} finally {
				// `stop(true)` would also close the browser's kept-alive connection, which the next sign-in's redirect may reuse.
				void listener.stop();
			}
		});
		return this.status();
	}

	/** Google's token endpoint's answer for `grant`, made with `client`. */
	async #token(grant: Record<string, string>, client: GoogleClient, signal?: AbortSignal): Promise<Record<string, unknown>> {
		const response = await fetch(TOKEN_URL, {
			method: "POST",
			body: new URLSearchParams({ ...grant, client_id: client.clientId, client_secret: client.clientSecret }),
			signal,
		});
		if (!response.ok) throw Object.assign(new Error(await refusal(response)), { status: response.status });
		const tokens: unknown = await response.json();
		if (!isObject(tokens)) throw new Error("Google's token endpoint answered no JSON object");
		return tokens;
	}

	async #accessToken(): Promise<string> {
		const stored = this.#stored;
		if (!stored?.refreshToken) throw new Error(NOT_CONNECTED);
		if (this.#access && this.#access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return this.#access.token;
		const tokens = await this.#token({ refresh_token: stored.refreshToken, grant_type: "refresh_token" }, stored).catch((err: Error & { status?: number }) => {
			// A refresh token that was revoked or expired never works again; only a new sign-in helps.
			if (err.status !== 400 || this.#stored !== stored) throw err;
			this.#store({ ...stored, refreshToken: null });
			throw new Error(`Google Calendar signed out (${err.message}). Reconnect it on the Integrations page.`);
		});
		const token = str(tokens.access_token);
		if (!token) throw new Error("Google gave no access token");
		const lifetime = typeof tokens.expires_in === "number" ? tokens.expires_in * 1000 : 0;
		this.#access = { token, expiresAt: Date.now() + lifetime };
		return token;
	}

	async #get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
		const token = await this.#accessToken();
		const response = await fetch(`${API_URL}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}` } });
		if (!response.ok) throw new Error(await refusal(response));
		const body: unknown = await response.json();
		if (!isObject(body)) throw new Error("Google Calendar answered no JSON object");
		return body;
	}

	/** Every page of a list at `path`, which Google splits with `nextPageToken`. */
	async #items(path: string, params: Record<string, string>): Promise<unknown[]> {
		const items: unknown[] = [];
		for (let pageToken: string | undefined; ; ) {
			const page = await this.#get(path, pageToken ? { ...params, pageToken } : params);
			if (Array.isArray(page.items)) items.push(...page.items);
			pageToken = str(page.nextPageToken);
			if (!pageToken) return items;
		}
	}

	/** The events from `from` to `to` of the calendars Google Calendar shows you, each repeat apart. `fresh` skips the minute's cache. */
	events(from: Date, to: Date, fresh = false): Promise<CalendarEventsAnswer> {
		return this.#events.get(
			`${from.toISOString()}/${to.toISOString()}`,
			async () => {
				const calendars = (await this.#items("/users/me/calendarList", { minAccessRole: "reader" })).flatMap(item => toCalendarInfo(item) ?? []);
				const params = { singleEvents: "true", orderBy: "startTime", timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: "2500" };
				const lists = await Promise.all(
					calendars.map(async calendar => (await this.#items(`/calendars/${encodeURIComponent(calendar.id)}/events`, params)).flatMap(item => toCalendarEvent(item, calendar) ?? [])),
				);
				return { events: lists.flat() };
			},
			fresh,
		);
	}
}
