/**
 * What the page sends, checked before anything acts on it: the socket's messages and the HTTP routes' bodies and queries.
 * Each socket message has one parser in {@link clientParsers}, so a {@link ClientMsg} variant without one does not compile.
 * Every parser returns a {@link Parsed}: `{ ok }` for a value, even a `null` one, and `null` for anything else, so no caller
 * casts what it received; a parser whose refusal the page shows returns `{ error }` in place of `null`.
 * A shape the server also keeps in a file, such as a routine, a scheduled send, or an event's time, is parsed by its domain module.
 */
import { BASE64, isDay, isNonEmpty, isObject, isSafeInteger, isTexts, oneOf, type Parsed, str } from "../json";
import { parseRoutineSpec, type RoutineChange } from "../routines";
import {
	GOOGLE_CLIENT_ID,
	type GoogleClientInput,
	type GoogleLinks,
	holdsAccounts,
	type IntegrationTarget,
	MCP_INTEGRATIONS,
	normalizeSlackScope,
	type SlackClientInput,
	slackRedirectError,
} from "../shared/accounts";
import { type McpServerAdd, type McpServerInput, REMOTE_TRANSPORTS } from "../shared/mcp-servers";
import { type CalendarShownInput, type EventRef, MAX_EVENT_TITLE, type NewEvent, type NewEventCalendar, parseEventWhen } from "../shared/calendar";
import { MAX_MAIL_BODY, type MailDraft, type MailPerson, type MailReply, type MailSend, type MailTrash } from "../shared/gmail";
import { parseImages, parseModel, parseNewSessionRequest, parseThinking } from "../shared/sessions";
import { MAX_PROMPT_DOCUMENT_BYTES, type PromptDocument } from "../shared/prompt-files";
import { MAX_TICKET_ATTACHMENT_BYTES, TICKET_ID, TICKET_PRIORITIES } from "../shared/tickets";
import { GITHUB_NAME, MAX_COMMENT_BODY, parsePullRequest, type PullRequest, type PullRequestChange, type PullRequestEdit, type Repo, SETTABLE_STATES } from "../shared/github";
import { NOTICE_OPS } from "../shared/notices";
import type { PinChange } from "../shared/pins";
import { isMaxWorkers, MAX_REVIEW_CADENCE, parseWatch, type ProjectEdit } from "../shared/projects";
import { parseScheduledSpec, type ScheduledChange } from "../shared/scheduled";
import { MAX_LOGIN_ANSWER } from "../shared/providers";
import { type AutoPullChange, MERGE_METHODS } from "../shared/source-control";
import type { AckedFrame, ClientFrame, ClientMsg } from "../shared/protocol";
import type { TerminalClientMsg } from "../shared/terminals";
import type { CompletionScope, LiveView, StartRequest, UserAnswer, View } from "../shared/sessions";
import type { TicketAttachmentUpload, TicketDraft, TicketEdit, TicketFieldValues, TodoTicketRequest } from "../shared/tickets";
import type { WorkspaceChange } from "../shared/workspaces";
import { MAX_TICKET_DESCRIPTION, MAX_TICKET_TITLE } from "../tickets";
import { isTodoId, parseTodoChange } from "../user-todos-parse";
import { MAX_WORKTREE_BATCH, type WorktreeConfirmation, type WorktreeRemovalRequest, type WorktreeTarget } from "../worktrees-shared";

/** The longest composer text the server completes. */
const MAX_COMPLETION_TEXT = 4096;
/** The longest project name the server keeps. */
const MAX_PROJECT_NAME = 200;

/** The variant of {@link ClientMsg} that `t` names. */
export type MsgOf<T extends ClientMsg["t"]> = Extract<ClientMsg, { t: T }>;

const isCounter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isNoticeOp = oneOf(NOTICE_OPS);

function parseLiveView(value: unknown): Parsed<LiveView> {
	if (!isObject(value) || value.kind !== "live") return null;
	const { instanceId, agentId } = value;
	if (typeof instanceId !== "string" || (agentId !== null && typeof agentId !== "string")) return null;
	return { ok: { kind: "live", instanceId, agentId } };
}

export function parseView(value: unknown): Parsed<View> {
	if (isObject(value) && value.kind === "past") {
		return typeof value.sessionId === "string" ? { ok: { kind: "past", sessionId: value.sessionId } } : null;
	}
	return parseLiveView(value);
}

function parseCompletionScope(value: unknown): Parsed<CompletionScope> {
	if (isObject(value) && value.kind === "new") {
		return isNonEmpty(value.cwd) ? { ok: { kind: "new", cwd: value.cwd } } : null;
	}
	const view = isObject(value) && value.kind === "live" ? parseLiveView(value.view) : null;
	return view && { ok: { kind: "live", view: view.ok } };
}

function parseAnswer(value: unknown): Parsed<UserAnswer> {
	if (!isObject(value)) return null;
	if (value.kind === "cancel") return { ok: { kind: "cancel" } };
	if (value.kind === "value" && typeof value.value === "string") return { ok: { kind: "value", value: value.value } };
	if (value.kind === "confirm" && typeof value.confirmed === "boolean") return { ok: { kind: "confirm", confirmed: value.confirmed } };
	return null;
}

function parseRoutineChange(value: unknown): Parsed<RoutineChange> {
	if (!isObject(value)) return null;
	const { op } = value;
	if (op === "save") {
		const routine = parseRoutineSpec(value.routine);
		return routine && { ok: { op, routine: routine.ok } };
	}
	const { id } = value;
	if (!isNonEmpty(id)) return null;
	switch (op) {
		case "enable":
			return typeof value.enabled === "boolean" ? { ok: { op, id, enabled: value.enabled } } : null;
		case "remove":
		case "run-now":
			return { ok: { op, id } };
		default:
			return null;
	}
}

/** One or more session ids to pin or unpin. */
function parsePinChange(value: unknown): Parsed<PinChange> {
	if (!isObject(value)) return null;
	const { op, sessionIds } = value;
	if (op !== "pin" && op !== "unpin") return null;
	return Array.isArray(sessionIds) && sessionIds.length > 0 && sessionIds.every(isNonEmpty) ? { ok: { op, sessionIds } } : null;
}

/** A rename or an archive of a project; the server makes every other change. */
function parseProjectEdit(value: unknown): Parsed<ProjectEdit> {
	if (!isObject(value) || !isNonEmpty(value.id)) return null;
	const { op, id, name } = value;
	if (op === "archive" || op === "unarchive") return { ok: { op, id } };
	if (op === "watch") {
		const watch = parseWatch(value.watch);
		return watch && { ok: { op, id, watch } };
	}
	if (op === "review-cadence") return typeof value.cadence === "string" && value.cadence.length <= MAX_REVIEW_CADENCE ? { ok: { op, id, cadence: value.cadence } } : null;
	if (op === "max-workers") return isMaxWorkers(value.max) ? { ok: { op, id, max: value.max } } : null;
	return op === "rename" && typeof name === "string" && name.length <= MAX_PROJECT_NAME ? { ok: { op, id, name } } : null;
}

function parseStartRequest(value: Record<string, unknown>): Parsed<StartRequest> {
	switch (value.kind) {
		case "new":
			return parseNewSessionRequest(value);
		case "fork": {
			const view = parseView(value.view);
			const { entryId } = value;
			return view && typeof entryId === "string" && entryId ? { ok: { kind: "fork", view: view.ok, entryId } } : null;
		}
		case "replay": {
			const view = parseView(value.view);
			const model = value.model === null ? { ok: null } : parseModel(value.model);
			const thinking = parseThinking(value.thinking);
			const { token, prompt } = value;
			return view && isNonEmpty(token) && model && thinking && (prompt === null || typeof prompt === "string") ? { ok: { kind: "replay", view: view.ok, token, prompt, model: model.ok, thinking: thinking.ok } } : null;
		}
		case "resume": {
			const { sessionId } = value;
			return typeof sessionId === "string" && sessionId ? { ok: { kind: "resume", sessionId } } : null;
		}
		default:
			return null;
	}
}

function parseScheduledChange(value: unknown): Parsed<ScheduledChange> {
	if (!isObject(value)) return null;
	const { op } = value;
	if (op === "add" || op === "update") {
		const send = parseScheduledSpec(value.send);
		return send && { ok: { op, send: send.ok } };
	}
	return (op === "remove" || op === "take" || op === "send-now") && isNonEmpty(value.id) ? { ok: { op, id: value.id } } : null;
}

/** A list of views, or `null` when it is not a list or one of them is malformed. */
function parseViews(value: unknown): View[] | null {
	if (!Array.isArray(value)) return null;
	const views: View[] = [];
	for (const raw of value) {
		const view = parseView(raw);
		if (!view) return null;
		views.push(view.ok);
	}
	return views;
}

/** Each socket message's parser, by its `t`. */
const clientParsers: { [T in ClientMsg["t"]]: (value: Record<string, unknown>) => Parsed<MsgOf<T>> } = {
	watch(value) {
		const views = parseViews(value.views);
		// A page loaded before the Trajectory tab existed sends no `trajectories` until it reloads.
		const trajectories = value.trajectories === undefined ? [] : parseViews(value.trajectories);
		return views && trajectories && { ok: { t: "watch", views, trajectories } };
	},
	prompt(value) {
		const view = parseLiveView(value.view);
		const { text, delivery } = value;
		const images = parseImages(value.images);
		if (!view || typeof text !== "string" || !images || (delivery !== "steer" && delivery !== "followUp")) return null;
		return text.trim() || images.ok.length > 0 ? { ok: { t: "prompt", view: view.ok, text, images: images.ok, delivery } } : null;
	},
	dequeue(value) {
		const view = parseLiveView(value.view);
		const { reqId, queue, text } = value;
		return view && isCounter(reqId) && (queue === "steering" || queue === "followUp") && typeof text === "string"
			? { ok: { t: "dequeue", reqId, view: view.ok, queue, text } }
			: null;
	},
	promote(value) {
		const view = parseLiveView(value.view);
		return view && typeof value.text === "string" ? { ok: { t: "promote", view: view.ok, text: value.text } } : null;
	},
	interrupt(value) {
		const view = parseLiveView(value.view);
		return view && isCounter(value.reqId) ? { ok: { t: "interrupt", reqId: value.reqId, view: view.ok } } : null;
	},
	complete(value) {
		const scope = parseCompletionScope(value.scope);
		const { reqId, text, cursor } = value;
		return scope &&
			isCounter(reqId) &&
			typeof text === "string" &&
			text.length <= MAX_COMPLETION_TEXT &&
			typeof cursor === "number" &&
			Number.isInteger(cursor) &&
			cursor >= 0 &&
			cursor <= text.length
			? { ok: { t: "complete", reqId, scope: scope.ok, text, cursor } }
			: null;
	},
	flush: ({ instanceId }) => (typeof instanceId === "string" ? { ok: { t: "flush", instanceId } } : null),
	"edit-prompt": ({ instanceId, entryId, text }) =>
		typeof instanceId === "string" && isNonEmpty(entryId) && typeof text === "string" && text.trim()
			? { ok: { t: "edit-prompt", instanceId, entryId, text } }
			: null,
	"cancel-agent"(value) {
		const view = parseLiveView(value.view);
		const agentId = view?.ok.agentId;
		return view && agentId ? { ok: { t: "cancel-agent", view: { ...view.ok, agentId } } } : null;
	},
	start(value) {
		const { reqId } = value;
		const request = parseStartRequest(value);
		return isCounter(reqId) && request ? { ok: { t: "start", reqId, ...request.ok } } : null;
	},
	"project-create"(value) {
		const { reqId, name, cwd, prompt } = value;
		// `null` starts the coordinator on omp's default model.
		const model = value.model === null ? { ok: null } : parseModel(value.model);
		const thinking = parseThinking(value.thinking);
		if (!isCounter(reqId) || typeof name !== "string" || name.length > MAX_PROJECT_NAME || !isNonEmpty(cwd) || !isNonEmpty(prompt) || !model || !thinking) return null;
		return { ok: { t: "project-create", reqId, name, cwd, prompt, model: model.ok, thinking: thinking.ok } };
	},
	"resume-all"({ reqId, sessionIds }) {
		if (!isCounter(reqId) || !Array.isArray(sessionIds) || sessionIds.length === 0) return null;
		return sessionIds.every(isNonEmpty) ? { ok: { t: "resume-all", reqId, sessionIds: [...new Set(sessionIds)] } } : null;
	},
	"dismiss-interrupted": ({ sessionId }) => (isNonEmpty(sessionId) ? { ok: { t: "dismiss-interrupted", sessionId } } : null),
	end: ({ instanceId }) => (typeof instanceId === "string" ? { ok: { t: "end", instanceId } } : null),
	read: ({ instanceId }) => (typeof instanceId === "string" ? { ok: { t: "read", instanceId } } : null),
	"list-models": ({ instanceId }) => (typeof instanceId === "string" ? { ok: { t: "list-models", instanceId } } : null),
	"set-model"(value) {
		const { instanceId } = value;
		const model = parseModel(value.model);
		const thinking = parseThinking(value.thinking);
		return typeof instanceId === "string" && model && thinking ? { ok: { t: "set-model", instanceId, model: model.ok, thinking: thinking.ok } } : null;
	},
	"set-thinking": ({ instanceId, level }) =>
		typeof instanceId === "string" && typeof level === "string" ? { ok: { t: "set-thinking", instanceId, level } } : null,
	"set-fast": ({ instanceId, enabled }) =>
		typeof instanceId === "string" && typeof enabled === "boolean" ? { ok: { t: "set-fast", instanceId, enabled } } : null,
	answer(value) {
		const { instanceId, requestId } = value;
		const answer = parseAnswer(value.answer);
		return typeof instanceId === "string" && typeof requestId === "string" && answer ? { ok: { t: "answer", instanceId, requestId, answer: answer.ok } } : null;
	},
	"user-todo"(value) {
		const change = parseTodoChange(value.change);
		return change && { ok: { t: "user-todo", change } };
	},
	routine(value) {
		const change = parseRoutineChange(value.change);
		return change ? { ok: { t: "routine", change: change.ok } } : null;
	},
	schedule(value) {
		const change = parseScheduledChange(value.change);
		return change && { ok: { t: "schedule", change: change.ok } };
	},
	pin(value) {
		const change = parsePinChange(value.change);
		return change && { ok: { t: "pin", change: change.ok } };
	},
	project(value) {
		const change = parseProjectEdit(value.change);
		return change && { ok: { t: "project", change: change.ok } };
	},
	notice: ({ ids, op }) => (Array.isArray(ids) && ids.length > 0 && ids.every(isNonEmpty) && isNoticeOp(op) ? { ok: { t: "notice", ids, op } } : null),
};

const isClientMsgType = (t: unknown): t is ClientMsg["t"] => typeof t === "string" && Object.hasOwn(clientParsers, t);

function parseFrame(value: unknown): Parsed<ClientMsg | AckedFrame> {
	if (!isObject(value) || !isClientMsgType(value.t)) return null;
	const msg = clientParsers[value.t](value);
	if (!msg) return null;
	const { ack, floor } = value;
	if (ack === undefined && floor === undefined) return msg;
	return isCounter(ack) && isCounter(floor) && floor <= ack ? { ok: { ...msg.ok, ack, floor } } : null;
}

/** A socket message from the page; `null` when it is not valid JSON or not a valid {@link ClientFrame}. */
export function parseClientMsg(raw: string | Buffer): Parsed<ClientFrame> {
	let value: unknown;
	try {
		value = JSON.parse(String(raw));
	} catch {
		return null;
	}
	if (!isObject(value) || value.t !== "resume") return parseFrame(value);
	if (!Array.isArray(value.frames)) return null;
	const frames: AckedFrame[] = [];
	for (const item of value.frames) {
		const frame = parseFrame(item);
		if (!frame || !("ack" in frame.ok)) return null;
		frames.push(frame.ok);
	}
	return { ok: { t: "resume", frames } };
}

/** A UUID as `crypto.randomUUID()` writes it, lowercase. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The `page` of a `/ws` address: the id a page load picks once, `crypto.randomUUID()`; `null` when absent or not one. */
export const parsePageId = (value: string | null): string | null => (value !== null && UUID.test(value) ? value : null);

/** A terminal's columns or rows: xterm's own bounds. */
const isTerminalSide = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000;

/** A text frame on a terminal socket; `null` when it is not one of {@link TerminalClientMsg}. */
export function parseTerminalMsg(raw: string): Parsed<TerminalClientMsg> {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isObject(value)) return null;
	if (value.t === "kill") return { ok: { t: "kill" } };
	if (value.t === "resize" && isTerminalSide(value.cols) && isTerminalSide(value.rows)) return { ok: { t: "resize", cols: value.cols, rows: value.rows } };
	return null;
}

/** `?id=<id>` of `/ws/terminal`, which attaches to a shell, or `?cwd=<dir>&cols=<n>&rows=<n>`, which opens one. */
export function parseTerminalQuery(params: URLSearchParams): Parsed<{ id: string } | { cwd: string; cols: number; rows: number }> {
	const id = params.get("id");
	if (id !== null) return isNonEmpty(id) ? { ok: { id } } : null;
	const cwd = params.get("cwd");
	const cols = Number(params.get("cols"));
	const rows = Number(params.get("rows"));
	return isNonEmpty(cwd) && isTerminalSide(cols) && isTerminalSide(rows) ? { ok: { cwd, cols, rows } } : null;
}

/** `?owner=<o>&repo=<r>&number=<n>` of `GET /api/pull-request` and its `/files` and `/file`. */
export function parsePullRequestQuery(params: URLSearchParams): Parsed<PullRequest> {
	return parsePullRequest(params.get("owner"), params.get("repo"), Number(params.get("number")));
}

const isSettableState = oneOf(SETTABLE_STATES);
const isMergeMethod = oneOf(MERGE_METHODS);
const COMMIT = /^[0-9a-f]{40,64}$/;
/** A GitHub node id: a review thread's `PRRT_…` id, or an older id's base64 with its `=` padding. */
const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/;
const isNodeId = (value: unknown): value is string => typeof value === "string" && NODE_ID.test(value);
const isCommentBody = (value: unknown): value is string => isNonEmpty(value) && value.length <= MAX_COMMENT_BODY;

function parsePullRequestChange(change: unknown): Parsed<PullRequestChange> {
	if (!isObject(change)) return null;
	if (change.field === "label" && isNonEmpty(change.name) && typeof change.on === "boolean") return { ok: { field: "label", name: change.name, on: change.on } };
	if (change.field === "reviewer" && typeof change.login === "string" && GITHUB_NAME.test(change.login) && typeof change.on === "boolean") return { ok: { field: "reviewer", login: change.login, on: change.on } };
	if (change.field === "state" && isSettableState(change.state)) return { ok: { field: "state", state: change.state } };
	if (change.field === "merge" && isMergeMethod(change.method) && typeof change.head === "string" && COMMIT.test(change.head)) return { ok: { field: "merge", method: change.method, head: change.head } };
	if (change.field === "thread" && isNodeId(change.id) && typeof change.resolved === "boolean") return { ok: { field: "thread", id: change.id, resolved: change.resolved } };
	if (change.field === "reply" && isNodeId(change.thread) && isCommentBody(change.body)) return { ok: { field: "reply", thread: change.thread, body: change.body } };
	if (change.field === "comment" && isCommentBody(change.body)) return { ok: { field: "comment", body: change.body } };
	return null;
}

/** The body of `PUT /api/pull-request`: a pull request and one change to it. */
export function parsePullRequestEdit(body: unknown): Parsed<PullRequestEdit> {
	if (!isObject(body)) return null;
	const pr = parsePullRequest(body.owner, body.repo, body.number);
	const change = parsePullRequestChange(body.change);
	return pr && change && { ok: { ...pr.ok, change: change.ok } };
}

/** The body of `PUT /api/source-control`. */
export function parseAutoPullChange(body: unknown): Parsed<AutoPullChange> {
	if (!isObject(body)) return null;
	if (body.op === "default" && typeof body.on === "boolean") return { ok: { op: "default", on: body.on } };
	if (body.op === "repo" && typeof body.repo === "string" && body.repo.startsWith("/") && (typeof body.on === "boolean" || body.on === null)) return { ok: { op: "repo", repo: body.repo, on: body.on } };
	return null;
}

/** `?owner=<o>&repo=<r>` of `GET /api/pull-request/options`. */
export function parseRepoQuery(params: URLSearchParams): Parsed<Repo> {
	const owner = params.get("owner") ?? "";
	const repo = params.get("repo") ?? "";
	return GITHUB_NAME.test(owner) && GITHUB_NAME.test(repo) ? { ok: { owner, repo } } : null;
}

const isMcpIntegration = oneOf(MCP_INTEGRATIONS);

/**
 * The body of `PUT /api/integrations/sign-in` and `/remove`: `{ id, account }`, an MCP integration and, for one of
 * many accounts, the account's server name, or `null` to add one; a service of one server takes no account.
 */
export function parseIntegrationTarget(body: unknown): Parsed<IntegrationTarget> {
	if (!isObject(body) || !isMcpIntegration(body.id)) return null;
	const account = body.account ?? null;
	if (account === null) return { ok: { id: body.id, account } };
	return holdsAccounts(body.id) && isNonEmpty(account) ? { ok: { id: body.id, account } } : null;
}

/** The body of `PUT /api/integrations/google-links`: `{ address, workspaces }`, an address and the absolute workspace directories its accounts are linked to. */
export const parseGoogleLinks = (body: unknown): Parsed<GoogleLinks> =>
	isObject(body) && isNonEmpty(body.address) && body.address.includes("@") && isTexts(body.workspaces) && body.workspaces.every(cwd => cwd.startsWith("/"))
		? { ok: { address: body.address, workspaces: body.workspaces } }
		: null;

/** The body of `PUT /api/mcp-servers/sign-in`, `/sign-out`, and `/remove`: `{ name }` naming a server omp loads. */
export const parseMcpServerName = (body: unknown): Parsed<string> => (isObject(body) && isNonEmpty(body.name) ? { ok: body.name } : null);

/** The body of `PUT /api/mcp-servers/enabled`: `{ name, enabled }`. */
export const parseMcpServerEnabled = (body: unknown): Parsed<{ name: string; enabled: boolean }> =>
	isObject(body) && isNonEmpty(body.name) && typeof body.enabled === "boolean" ? { ok: { name: body.name, enabled: body.enabled } } : null;

const isRemoteTransport = oneOf(REMOTE_TRANSPORTS);
/** An HTTP header name, as RFC 9110 spells a token. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * The body of `PUT /api/mcp-servers/add`: `{ catalog }` naming a catalog entry, or `{ name, url, transport?, header? }`.
 * The address must be HTTPS, or HTTP on this computer, so a sign-in's token never crosses the network in the clear.
 */
export function parseMcpServerAdd(body: unknown): Parsed<McpServerAdd, { error: string }> {
	if (!isObject(body)) return { error: "Expected { catalog } or { name, url } for the MCP server." };
	if (body.catalog !== undefined) return isNonEmpty(body.catalog) ? { ok: { kind: "catalog", id: body.catalog } } : { error: "Expected { catalog } naming a catalog entry." };
	const name = typeof body.name === "string" ? body.name.trim() : "";
	if (!name) return { error: "Enter a name for the server." };
	const url = typeof body.url === "string" ? body.url.trim() : "";
	const parsed = URL.canParse(url) ? new URL(url) : null;
	if (!parsed || !(parsed.protocol === "https:" || (parsed.protocol === "http:" && LOOPBACK_HOSTS.includes(parsed.hostname)))) {
		return { error: "Enter the server's https:// address." };
	}
	const transport = body.transport ?? "http";
	if (!isRemoteTransport(transport)) return { error: "Expected transport http or sse." };
	let header: McpServerInput["header"] = null;
	if (body.header !== undefined && body.header !== null) {
		const headerName = isObject(body.header) && typeof body.header.name === "string" ? body.header.name.trim() : "";
		const value = isObject(body.header) && typeof body.header.value === "string" ? body.header.value.trim() : "";
		if (!HEADER_NAME.test(headerName)) return { error: "Enter the header's name, such as Authorization." };
		if (!value) return { error: "Enter the header's value." };
		header = { name: headerName, value };
	}
	return { ok: { kind: "custom", name, url, transport, header } };
}

/** The body of `PUT /api/providers/login`: `{ method }`, the `/login` entry to run. */
export const parseLoginMethod = (body: unknown): Parsed<string> => (isObject(body) && isNonEmpty(body.method) ? { ok: body.method } : null);

/** The body of `PUT /api/providers/login/answer`: `{ prompt, value }`, the question's id and its answer. */
export const parseLoginAnswer = (body: unknown): Parsed<{ prompt: number; value: string }> =>
	isObject(body) && isSafeInteger(body.prompt) && typeof body.value === "string" && body.value.length <= MAX_LOGIN_ANSWER
		? { ok: { prompt: body.prompt, value: body.value } }
		: null;

/** The body of `PUT /api/providers/sign-out`: `{ provider, credentialId }`, one stored credential of that provider. */
export const parseProviderSignOut = (body: unknown): Parsed<{ provider: string; credentialId: number }> =>
	isObject(body) && isNonEmpty(body.provider) && isSafeInteger(body.credentialId) ? { ok: { provider: body.provider, credentialId: body.credentialId } } : null;

/** The body of `PUT /api/google/calendars`: `{ account, id, shown }`, a Google calendar's account and id and whether the Calendar page shows it. */
export const parseCalendarShown = (body: unknown): Parsed<CalendarShownInput> =>
	isObject(body) && isNonEmpty(body.account) && isNonEmpty(body.id) && typeof body.shown === "boolean" ? { ok: { account: body.account, id: body.id, shown: body.shown } } : null;

function parseNewEventCalendar(value: unknown): Parsed<NewEventCalendar> {
	if (!isObject(value)) return null;
	if (value.kind === "local") return { ok: { kind: "local" } };
	return value.kind === "google" && isNonEmpty(value.account) && isNonEmpty(value.calendarId) ? { ok: { kind: "google", account: value.account, calendarId: value.calendarId } } : null;
}

/** The body of `PUT /api/calendar/events/new`: a trimmed title of at most {@link MAX_EVENT_TITLE} characters, when it happens, and the calendar it goes in. */
export function parseNewEvent(body: unknown): Parsed<NewEvent> {
	if (!isObject(body) || !isNonEmpty(body.title)) return null;
	const title = body.title.trim();
	const when = parseEventWhen(body.when);
	const calendar = parseNewEventCalendar(body.calendar);
	return title.length <= MAX_EVENT_TITLE && when && calendar ? { ok: { title, when: when.ok, calendar: calendar.ok } } : null;
}

/** The body of `PUT /api/calendar/events/delete`: an event kept on this computer by its id, or a Google event by its account, its calendar's id, and its own. */
export function parseEventRef(body: unknown): Parsed<EventRef> {
	if (!isObject(body)) return null;
	if (body.kind === "local") return isNonEmpty(body.id) ? { ok: { kind: "local", id: body.id } } : null;
	if (body.kind === "google") {
		return isNonEmpty(body.account) && isNonEmpty(body.calendarId) && isNonEmpty(body.eventId)
			? { ok: { kind: "google", account: body.account, calendarId: body.calendarId, eventId: body.eventId } }
			: null;
	}
	return null;
}

/** The most people one field of a sent mail names. */
const MAX_RECIPIENTS = 100;

/** A body's `key` as people to write to: each `{ name, address }` with an address holding an `@`, else `null`. */
function peopleIn(body: Record<string, unknown>, key: string): MailPerson[] | null {
	const list = body[key];
	if (!Array.isArray(list) || list.length > MAX_RECIPIENTS) return null;
	const people = list.flatMap(item =>
		isObject(item) && typeof item.name === "string" && typeof item.address === "string" && /^[^\s@<>,]+@[^\s@<>,]+$/.test(item.address)
			? [{ name: item.name.replace(/[\r\n]/g, " "), address: item.address }]
			: [],
	);
	return people.length === list.length ? people : null;
}

/** A body's draft without its subject, `null` when a field is missing or too long, or it names no one to write to. */
function draftIn(body: Record<string, unknown>): Omit<MailDraft, "subject"> | null {
	if (typeof body.html !== "string" || !isNonEmpty(body.text) || body.text.length > MAX_MAIL_BODY || body.html.length > MAX_MAIL_BODY) return null;
	const [to, cc, bcc] = [peopleIn(body, "to"), peopleIn(body, "cc"), peopleIn(body, "bcc")];
	if (!to || !cc || !bcc || to.length + cc.length + bcc.length === 0) return null;
	return { to, cc, bcc, html: body.html, text: body.text };
}

/** The body of `PUT /api/gmail/reply`: the account and conversation to answer, and the reply. */
export function parseMailReply(body: unknown): Parsed<MailReply> {
	if (!isObject(body) || !isNonEmpty(body.account) || !isNonEmpty(body.thread)) return null;
	const draft = draftIn(body);
	return draft && { ok: { ...draft, account: body.account, thread: body.thread } };
}

/** The body of `PUT /api/gmail/send`: a new mail from an account, its subject on one line. */
export function parseMailSend(body: unknown): Parsed<MailSend> {
	if (!isObject(body) || !isNonEmpty(body.account) || typeof body.subject !== "string" || body.subject.length > 1000) return null;
	const draft = draftIn(body);
	return draft && { ok: { ...draft, account: body.account, subject: body.subject.replace(/[\r\n]/g, " ") } };
}

/** The body of `PUT /api/gmail/trash`: the account and conversation to move to Trash. */
export const parseMailTrash = (body: unknown): Parsed<MailTrash> =>
	isObject(body) && isNonEmpty(body.account) && isNonEmpty(body.thread) ? { ok: { account: body.account, thread: body.thread } } : null;

const validPort = (port: unknown): port is number => typeof port === "number" && Number.isSafeInteger(port) && port >= 1 && port <= 65535;

/** A body's `clientSecret`: trimmed, `undefined` when left out or empty so the saved secret can stay, `null` when it is not a string. */
function secretOf(body: Record<string, unknown>): string | undefined | null {
	if (body.clientSecret === undefined) return undefined;
	if (typeof body.clientSecret !== "string") return null;
	return body.clientSecret.trim() || undefined;
}

/** The body of `PUT /api/integrations/slack/client`. An empty secret is omitted so the saved secret can stay. */
export function parseSlackClient(body: unknown): Parsed<SlackClientInput, { error: string }> {
	if (!isObject(body)) return { error: "Expected { clientId, redirectUri, callbackPort, scope } for the Slack app." };
	if (typeof body.clientId !== "string" || body.clientId.trim() === "") return { error: "Slack needs the app's client ID." };
	const clientSecret = secretOf(body);
	if (clientSecret === null) return { error: "Expected clientSecret to be a string." };
	if (typeof body.redirectUri !== "string" || body.redirectUri.trim() === "") return { error: "Enter the HTTPS redirect registered on the Slack app." };
	if (!validPort(body.callbackPort)) return { error: "Enter a local callback port from 1 to 65535." };
	if (typeof body.scope !== "string") return { error: "Choose at least one Slack scope from the supported chat and search set." };
	const scope = normalizeSlackScope(body.scope);
	if (!scope) return { error: "Choose at least one Slack scope from the supported chat and search set." };
	const redirectUri = body.redirectUri.trim();
	const redirectError = slackRedirectError(redirectUri, body.callbackPort);
	if (redirectError) return { error: redirectError };
	const clientId = body.clientId.trim();
	return { ok: clientSecret === undefined ? { clientId, redirectUri, callbackPort: body.callbackPort, scope } : { clientId, clientSecret, redirectUri, callbackPort: body.callbackPort, scope } };
}

/** The body of `PUT /api/integrations/<google-calendar|gmail>/client`. An empty secret is omitted so the saved secret can stay. */
export function parseGoogleClient(body: unknown): Parsed<GoogleClientInput, { error: string }> {
	if (!isObject(body)) return { error: "Expected { clientId, callbackPort } for the Google OAuth client." };
	const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
	if (!GOOGLE_CLIENT_ID.test(clientId)) return { error: "Enter the OAuth client's ID, which ends in .apps.googleusercontent.com." };
	const clientSecret = secretOf(body);
	if (clientSecret === null) return { error: "Expected clientSecret to be a string." };
	if (!validPort(body.callbackPort)) return { error: "Enter a local callback port from 1 to 65535." };
	return { ok: clientSecret === undefined ? { clientId, callbackPort: body.callbackPort } : { clientId, clientSecret, callbackPort: body.callbackPort } };
}

const isTicketPriority = oneOf(TICKET_PRIORITIES);

/** The fields a picker sets, each left out unchanged and `null` clearing it, each of its own type; `null` for any other value. */
function parseTicketFields(body: Record<string, unknown>): Parsed<TicketFieldValues> {
	const { state, assignee, priority, labels, project, dueDate } = body;
	const fields: TicketFieldValues = {};
	if (state !== undefined) {
		if (!isNonEmpty(state)) return null;
		fields.state = state;
	}
	if (assignee !== undefined) {
		if (assignee !== null && !isNonEmpty(assignee)) return null;
		fields.assignee = assignee;
	}
	if (priority !== undefined) {
		if (!isTicketPriority(priority)) return null;
		fields.priority = priority;
	}
	if (labels !== undefined) {
		if (!Array.isArray(labels) || !labels.every(isNonEmpty)) return null;
		fields.labels = [...new Set(labels)];
	}
	if (project !== undefined) {
		if (project !== null && !isNonEmpty(project)) return null;
		fields.project = project;
	}
	if (dueDate !== undefined) {
		if (dueDate !== null && !isDay(dueDate)) return null;
		fields.dueDate = dueDate;
	}
	return { ok: fields };
}

/** The body of `PUT /api/ticket/new`: a title and a description, each within its limit, a team by id, and any picker's fields. */
export function parseTicketDraft(body: unknown): Parsed<TicketDraft> {
	if (!isObject(body)) return null;
	const { title, description, team } = body;
	if (!isNonEmpty(title) || title.length > MAX_TICKET_TITLE || typeof description !== "string" || description.length > MAX_TICKET_DESCRIPTION || !isNonEmpty(team)) return null;
	const fields = parseTicketFields(body);
	return fields && { ok: { ...fields.ok, title: title.trim(), description, team } };
}

/** The body of `PUT /api/todo/ticket`: a todo by id, and a Linear team by id. */
export function parseTodoTicket(body: unknown): Parsed<TodoTicketRequest> {
	if (!isObject(body) || !isTodoId(body.todoId) || !isNonEmpty(body.team)) return null;
	return { ok: { todoId: body.todoId, team: body.team } };
}

/** The body of `PUT /api/ticket`: an issue identifier and at least one field to change, each of its own type. */
export function parseTicketEdit(body: unknown): Parsed<TicketEdit> {
	if (!isObject(body) || typeof body.id !== "string" || !TICKET_ID.test(body.id)) return null;
	const fields = parseTicketFields(body);
	return fields && Object.keys(fields.ok).length > 0 ? { ok: { id: body.id, ...fields.ok } } : null;
}

/** The body of `PUT /api/ticket/attachment`: an issue identifier, a file name and MIME type, and its bytes in base64 within the size limit. */
export function parseTicketAttachment(body: unknown): Parsed<TicketAttachmentUpload> {
	if (!isObject(body)) return null;
	const { issue, name, type, data } = body;
	if (typeof issue !== "string" || !TICKET_ID.test(issue) || !isNonEmpty(name) || !isNonEmpty(type) || typeof data !== "string") return null;
	if (data.length > Math.ceil(MAX_TICKET_ATTACHMENT_BYTES / 3) * 4 || (data !== "" && !BASE64.test(data))) return null;
	return { ok: { issue, name, type, data } };
}

/** The body of `PUT /api/attachment/document`: a file name, and the file's bytes in base64 within the size limit. */
export function parsePromptDocument(body: unknown): Parsed<PromptDocument> {
	if (!isObject(body)) return null;
	const { name, data } = body;
	if (!isNonEmpty(name) || typeof data !== "string" || data.length > Math.ceil(MAX_PROMPT_DOCUMENT_BYTES / 3) * 4) return null;
	return data === "" || BASE64.test(data) ? { ok: { name, data } } : null;
}

export const SHA256 = /^[0-9a-f]{64}$/;

const parseWorktreeTarget = (value: unknown): Parsed<WorktreeTarget> =>
	isObject(value) && isNonEmpty(value.repository) && isNonEmpty(value.path) ? { ok: { repository: value.repository, path: value.path } } : null;

/** The body of `PUT /api/worktrees/removal`: a preview of up to `MAX_WORKTREE_BATCH` registered checkouts, `merged` for **Remove merged**, or the confirmations from such a preview. */
export function parseWorktreeRemoval(body: unknown): Parsed<WorktreeRemovalRequest> {
	if (!isObject(body)) return null;
	if (body.action === "preview") {
		if (!Array.isArray(body.targets) || body.targets.length === 0 || body.targets.length > MAX_WORKTREE_BATCH) return null;
		const targets: WorktreeTarget[] = [];
		for (const item of body.targets) {
			const target = parseWorktreeTarget(item);
			if (!target) return null;
			targets.push(target.ok);
		}
		return { ok: { action: "preview", targets, merged: body.merged === true } };
	}
	if (body.action !== "remove" || !Array.isArray(body.plans) || body.plans.length === 0 || body.plans.length > MAX_WORKTREE_BATCH) return null;
	const plans: WorktreeConfirmation[] = [];
	for (const item of body.plans) {
		const target = parseWorktreeTarget(item);
		const confirmation = isObject(item) ? str(item.confirmation) : undefined;
		if (!target || !confirmation || !SHA256.test(confirmation)) return null;
		plans.push({ ...target.ok, confirmation });
	}
	return { ok: { action: "remove", plans } };
}

/** The body of `PUT /api/worktree/release`: `{ cwd, branch }`, an absolute directory in the repository and the branch whose linked worktree goes. */
export const parseBranchRelease = (body: unknown): Parsed<{ cwd: string; branch: string }> =>
	isObject(body) && isNonEmpty(body.cwd) && body.cwd.startsWith("/") && isNonEmpty(body.branch) ? { ok: { cwd: body.cwd, branch: body.branch } } : null;

const isWorkspaceOp = oneOf(["add", "hide", "show"] as const);

/** The body of `PUT /api/workspaces`: `{ op, cwd }`. Adding takes any path a new session takes; hiding and showing name an absolute directory. */
export function parseWorkspaceChange(body: unknown): Parsed<WorkspaceChange> {
	if (!isObject(body) || !isWorkspaceOp(body.op) || !isNonEmpty(body.cwd)) return null;
	return body.op === "add" || body.cwd.startsWith("/") ? { ok: { op: body.op, cwd: body.cwd } } : null;
}
