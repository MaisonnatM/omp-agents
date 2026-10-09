/**
 * What the page sends, checked before anything acts on it: the socket's messages and the HTTP routes' bodies and queries.
 * Each socket message has one parser in {@link clientParsers}, so a {@link ClientMsg} variant without one does not compile.
 * Socket parsers return `{ ok }` for a value, even a `null` one, and `null` for anything else, so no caller casts what it received.
 */
import { isObject, nonEmpty, nonEmptyStr, oneOf, str } from "../json";
import { MAX_COMMAND_LENGTH, type RoutineChange, type RoutineTask, type Schedule, type Schedules, type Weekday } from "../routines";
import { type CalendarShownInput, GOOGLE_CLIENT_ID, type GoogleClientInput, MCP_INTEGRATIONS, type McpIntegrationId, normalizeSlackScope, type SlackClientInput, slackRedirectError } from "../shared/accounts";
import { MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_TYPES } from "../shared/sessions";
import { MAX_TICKET_ATTACHMENT_BYTES, TICKET_ID, TICKET_PRIORITIES } from "../shared/tickets";
import type { BranchChoice } from "../shared/git";
import { type PullRequest, type PullRequestChange, type PullRequestEdit, type Repo, SETTABLE_STATES } from "../shared/github";
import type { ModelOption } from "../shared/models";
import { NOTICE_OPS } from "../shared/notices";
import type { PinChange } from "../shared/pins";
import type { ProjectChange } from "../shared/projects";
import type { ClientMsg } from "../shared/protocol";
import type { TerminalClientMsg } from "../shared/terminals";
import type { CompletionScope, LiveView, PromptImage, StartRequest, UserAnswer, View, WorkItem } from "../shared/sessions";
import type { TicketAttachmentUpload, TicketDraft, TicketEdit, TicketFieldValues } from "../shared/tickets";
import { MAX_TICKET_DESCRIPTION, MAX_TICKET_TITLE } from "../tickets";
import { isDay, isTodoId, parseTodoChange } from "../user-todos-parse";
import type { WorktreeConfirmation, WorktreeRemovalRequest, WorktreeTarget } from "../worktrees-shared";

/** The longest composer text the server completes. */
const MAX_COMPLETION_TEXT = 4096;
/** GitHub's owner and repository names. */
const NAME = /^[\w.-]+$/;

/** A checked value, or `null` when it is not one. */
type Parsed<T> = { ok: T } | null;

/** The variant of {@link ClientMsg} that `t` names. */
export type MsgOf<T extends ClientMsg["t"]> = Extract<ClientMsg, { t: T }>;

const isCounter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const isNoticeOp = oneOf(NOTICE_OPS);

function parseLiveView(value: unknown): Parsed<LiveView> {
	if (!isObject(value) || value.kind !== "live") return null;
	const { instanceId, agentId } = value;
	if (typeof instanceId !== "string" || (agentId !== null && typeof agentId !== "string")) return null;
	return { ok: { kind: "live", instanceId, agentId } };
}

function parseView(value: unknown): Parsed<View> {
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

/** `{ ok: null }` for no branch. */
function parseBranchChoice(value: unknown): Parsed<BranchChoice | null> {
	if (value === null || value === undefined) return { ok: null };
	if (!isObject(value) || !isNonEmpty(value.name)) return null;
	if (value.kind === "existing") return { ok: { kind: "existing", name: value.name } };
	return value.kind === "new" && isNonEmpty(value.base) ? { ok: { kind: "new", name: value.name, base: value.base } } : null;
}

function parseModel(value: unknown): Parsed<ModelOption> {
	return isObject(value) && isNonEmpty(value.provider) && isNonEmpty(value.id) ? { ok: { provider: value.provider, id: value.id } } : null;
}

/** The longest base64 of {@link MAX_PROMPT_IMAGE_BYTES}. */
const MAX_PROMPT_IMAGE_BASE64 = Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A prompt's images: `[]` when it sends none, `null` for anything but images of {@link PROMPT_IMAGE_TYPES} within the size limit. */
function parseImages(value: unknown): Parsed<PromptImage[]> {
	if (value === undefined) return { ok: [] };
	if (!Array.isArray(value)) return null;
	const images: PromptImage[] = [];
	let size = 0;
	for (const image of value) {
		if (!isObject(image) || typeof image.data !== "string" || typeof image.mimeType !== "string") return null;
		if (!PROMPT_IMAGE_TYPES.includes(image.mimeType) || !BASE64.test(image.data)) return null;
		size += image.data.length;
		images.push({ data: image.data, mimeType: image.mimeType });
	}
	return size <= MAX_PROMPT_IMAGE_BASE64 ? { ok: images } : null;
}

/** `{ ok: null }` for none, which keeps omp's thinking level. */
function parseThinking(value: unknown): Parsed<string | null> {
	if (value === null || value === undefined) return { ok: null };
	return isNonEmpty(value) ? { ok: value } : null;
}

/** `{ ok: null }` for no pinned skill; only one token passes, as `/skill:<name>` takes a name. */
function parseSkill(value: unknown): Parsed<string | null> {
	if (value === null || value === undefined) return { ok: null };
	return typeof value === "string" && /^\S+$/.test(value) ? { ok: value } : null;
}

/** `{ ok: null }` for a start that works on nothing in particular. */
function parseWorkItem(value: unknown): Parsed<WorkItem | null> {
	if (value === null || value === undefined) return { ok: null };
	if (!isObject(value)) return null;
	if (value.kind === "ticket") return typeof value.id === "string" && TICKET_ID.test(value.id) ? { ok: { kind: "ticket", id: value.id } } : null;
	if (value.kind !== "pull-request" || !isObject(value.pr)) return null;
	const pr = parsePullRequest(value.pr.owner, value.pr.repo, value.pr.number);
	return pr && { ok: { kind: "pull-request", pr } };
}

const isIntIn = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const isWeekday = (value: unknown): value is Weekday => isIntIn(value, 0, 6);

function parseSchedule(value: unknown): Parsed<Schedule> {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "every":
			return isIntIn(value.minutes, 1, Number.MAX_SAFE_INTEGER) ? { ok: { kind: "every", minutes: value.minutes } } : null;
		case "weekly": {
			const { days, time } = value;
			if (!Array.isArray(days) || days.length === 0 || !days.every(isWeekday) || new Set(days).size !== days.length) return null;
			if (!isObject(time) || !isIntIn(time.hour, 0, 23) || !isIntIn(time.minute, 0, 59)) return null;
			return { ok: { kind: "weekly", days, time: { hour: time.hour, minute: time.minute } } };
		}
		default:
			return null;
	}
}

/** One or more schedules. An empty list is not one. */
function parseSchedules(value: unknown): Parsed<Schedules> {
	if (!Array.isArray(value)) return null;
	const schedules: Schedule[] = [];
	for (const entry of value) {
		const schedule = parseSchedule(entry);
		if (!schedule) return null;
		schedules.push(schedule.ok);
	}
	const nonEmptySchedules = nonEmpty(schedules);
	return nonEmptySchedules && { ok: nonEmptySchedules };
}

function parseRoutineTask(value: unknown): Parsed<RoutineTask> {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "prompt":
			return isNonEmpty(value.prompt) && typeof value.pin === "boolean" ? { ok: { kind: "prompt", prompt: value.prompt, pin: value.pin } } : null;
		case "command":
			return isNonEmpty(value.command) && value.command.length <= MAX_COMMAND_LENGTH ? { ok: { kind: "command", command: value.command } } : null;
		default:
			return null;
	}
}

/** What the page edits of a routine: all but its runs and its creation time, which the server keeps. */
export type RoutineSpec = Extract<RoutineChange, { op: "save" }>["routine"];

/** A routine as the page saves it, or `null` when a field is missing, of the wrong type, or out of range; other fields drop. */
export function parseRoutineSpec(value: unknown): Parsed<RoutineSpec> {
	if (!isObject(value)) return null;
	const { id, name, cwd, enabled } = value;
	const schedules = parseSchedules(value.schedules);
	const task = parseRoutineTask(value.task);
	const skill = parseSkill(value.skill);
	if (!isNonEmpty(id) || !isNonEmpty(name) || !isNonEmpty(cwd) || typeof enabled !== "boolean" || !schedules || !task || !skill) return null;
	return { ok: { id, name, cwd, schedules: schedules.ok, task: task.ok, skill: skill.ok, enabled } };
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
function parsePinChange(value: unknown): PinChange | null {
	if (!isObject(value)) return null;
	const { op, sessionIds } = value;
	if (op !== "pin" && op !== "unpin") return null;
	return Array.isArray(sessionIds) && sessionIds.length > 0 && sessionIds.every(isNonEmpty) ? { op, sessionIds } : null;
}

function parseStartRequest(value: Record<string, unknown>): Parsed<StartRequest> {
	switch (value.kind) {
		case "new": {
			const { cwd, prompt, todoId = null } = value;
			const images = parseImages(value.images);
			const branch = parseBranchChoice(value.branch);
			// `null` starts on omp's default model.
			const model = value.model === null || value.model === undefined ? { ok: null } : parseModel(value.model);
			const thinking = parseThinking(value.thinking);
			const skill = parseSkill(value.skill);
			const subject = parseWorkItem(value.subject);
			if (!isNonEmpty(cwd) || typeof prompt !== "string" || !images || !branch || !model || !thinking || !skill || !subject) return null;
			if (todoId !== null && !isTodoId(todoId)) return null;
			return prompt.trim() || images.ok.length > 0
				? { ok: { kind: "new", cwd, prompt, images: images.ok, branch: branch.ok, model: model.ok, thinking: thinking.ok, skill: skill.ok, subject: subject.ok, todoId } }
				: null;
		}
		case "fork": {
			const view = parseView(value.view);
			const { entryId } = value;
			return view && typeof entryId === "string" && entryId ? { ok: { kind: "fork", view: view.ok, entryId } } : null;
		}
		case "resume": {
			const { sessionId } = value;
			return typeof sessionId === "string" && sessionId ? { ok: { kind: "resume", sessionId } } : null;
		}
		default:
			return null;
	}
}

/** Each socket message's parser, by its `t`. */
const clientParsers: { [T in ClientMsg["t"]]: (value: Record<string, unknown>) => Parsed<MsgOf<T>> } = {
	watch(value) {
		if (!Array.isArray(value.views)) return null;
		const views: View[] = [];
		for (const raw of value.views) {
			const view = parseView(raw);
			if (!view) return null;
			views.push(view.ok);
		}
		return { ok: { t: "watch", views } };
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
	"resume-all"({ reqId, sessionIds }) {
		if (!isCounter(reqId) || !Array.isArray(sessionIds) || sessionIds.length === 0) return null;
		return sessionIds.every(isNonEmpty) ? { ok: { t: "resume-all", reqId, sessionIds: [...new Set(sessionIds)] } } : null;
	},
	"dismiss-interrupted": ({ sessionId }) => (isNonEmpty(sessionId) ? { ok: { t: "dismiss-interrupted", sessionId } } : null),
	end: ({ instanceId }) => (typeof instanceId === "string" ? { ok: { t: "end", instanceId } } : null),
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
	pin(value) {
		const change = parsePinChange(value.change);
		return change && { ok: { t: "pin", change } };
	},
	notice: ({ id, op }) => (isNonEmpty(id) && isNoticeOp(op) ? { ok: { t: "notice", id, op } } : null),
};

const isClientMsgType = (t: unknown): t is ClientMsg["t"] => typeof t === "string" && Object.hasOwn(clientParsers, t);

/** A socket message from the page, or `null` when it is not valid JSON or not one of {@link ClientMsg}. */
export function parseClientMsg(raw: string | Buffer): ClientMsg | null {
	let value: unknown;
	try {
		value = JSON.parse(String(raw));
	} catch {
		return null;
	}
	if (!isObject(value) || !isClientMsgType(value.t)) return null;
	return clientParsers[value.t](value)?.ok ?? null;
}

/** A terminal's columns or rows: xterm's own bounds. */
const isTerminalSide = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000;

/** A text frame on a terminal socket, or `null` when it is not one of {@link TerminalClientMsg}. */
export function parseTerminalMsg(raw: string): TerminalClientMsg | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isObject(value)) return null;
	if (value.t === "kill") return { t: "kill" };
	if (value.t === "resize" && isTerminalSide(value.cols) && isTerminalSide(value.rows)) return { t: "resize", cols: value.cols, rows: value.rows };
	return null;
}

/** `?id=<id>` of `/ws/terminal`, which attaches to a shell, or `?cwd=<dir>&cols=<n>&rows=<n>`, which opens one. */
export function parseTerminalQuery(params: URLSearchParams): { id: string } | { cwd: string; cols: number; rows: number } | null {
	const id = params.get("id");
	if (id !== null) return isNonEmpty(id) ? { id } : null;
	const cwd = params.get("cwd");
	const cols = Number(params.get("cols"));
	const rows = Number(params.get("rows"));
	return isNonEmpty(cwd) && isTerminalSide(cols) && isTerminalSide(rows) ? { cwd, cols, rows } : null;
}

/** A pull request named by an owner, repository, and number, as the routes that take one receive them. */
export function parsePullRequest(owner: unknown, repo: unknown, number: unknown): PullRequest | null {
	if (typeof owner !== "string" || typeof repo !== "string" || !NAME.test(owner) || !NAME.test(repo)) return null;
	return typeof number === "number" && Number.isSafeInteger(number) && number >= 1 ? { owner, repo, number } : null;
}

/** `?owner=<o>&repo=<r>&number=<n>` of `GET /api/pull-request` and its `/files` and `/file`. */
export function parsePullRequestQuery(params: URLSearchParams): PullRequest | null {
	return parsePullRequest(params.get("owner"), params.get("repo"), Number(params.get("number")));
}

const isSettableState = oneOf(SETTABLE_STATES);

function parsePullRequestChange(change: unknown): PullRequestChange | null {
	if (!isObject(change)) return null;
	if (change.field === "label" && isNonEmpty(change.name) && typeof change.on === "boolean") return { field: "label", name: change.name, on: change.on };
	if (change.field === "reviewer" && typeof change.login === "string" && NAME.test(change.login) && typeof change.on === "boolean") return { field: "reviewer", login: change.login, on: change.on };
	if (change.field === "state" && isSettableState(change.state)) return { field: "state", state: change.state };
	return null;
}

/** The body of `PUT /api/pull-request`: a pull request and one change to it. */
export function parsePullRequestEdit(body: unknown): PullRequestEdit | null {
	if (!isObject(body)) return null;
	const pr = parsePullRequest(body.owner, body.repo, body.number);
	const change = parsePullRequestChange(body.change);
	return pr && change && { ...pr, change };
}

/** `?owner=<o>&repo=<r>` of `GET /api/pull-request/options`. */
export function parseRepoQuery(params: URLSearchParams): Repo | null {
	const owner = params.get("owner") ?? "";
	const repo = params.get("repo") ?? "";
	return NAME.test(owner) && NAME.test(repo) ? { owner, repo } : null;
}

const isMcpIntegration = oneOf(MCP_INTEGRATIONS);

/** The body of `PUT /api/integrations/sign-in` and `/sign-out`: `{ id }` naming an MCP integration. */
export const parseIntegrationId = (body: unknown): McpIntegrationId | null => (isObject(body) && isMcpIntegration(body.id) ? body.id : null);

/** The body of `PUT /api/google/calendars`: `{ id, shown }`, a Google calendar's id and whether the Calendar page shows it. */
export const parseCalendarShown = (body: unknown): CalendarShownInput | null =>
	isObject(body) && isNonEmpty(body.id) && typeof body.shown === "boolean" ? { id: body.id, shown: body.shown } : null;

const validPort = (port: unknown): port is number => typeof port === "number" && Number.isSafeInteger(port) && port >= 1 && port <= 65535;

/** A body's `clientSecret`: trimmed, `undefined` when left out or empty so the saved secret can stay, `null` when it is not a string. */
function secretOf(body: Record<string, unknown>): string | undefined | null {
	if (body.clientSecret === undefined) return undefined;
	if (typeof body.clientSecret !== "string") return null;
	return body.clientSecret.trim() || undefined;
}

/** The body of `PUT /api/integrations/slack/client`. An empty secret is omitted so the saved secret can stay. */
export function parseSlackClient(body: unknown): { ok: SlackClientInput } | { error: string } {
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

/** The body of `PUT /api/integrations/google-calendar/client`. An empty secret is omitted so the saved secret can stay. */
export function parseGoogleClient(body: unknown): { ok: GoogleClientInput } | { error: string } {
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
function parseTicketFields(body: Record<string, unknown>): TicketFieldValues | null {
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
	return fields;
}

/** The body of `PUT /api/ticket/new`: a title and a description, each within its limit, a team by id, and any picker's fields. */
export function parseTicketDraft(body: unknown): TicketDraft | null {
	if (!isObject(body)) return null;
	const { title, description, team } = body;
	if (!isNonEmpty(title) || title.length > MAX_TICKET_TITLE || typeof description !== "string" || description.length > MAX_TICKET_DESCRIPTION || !isNonEmpty(team)) return null;
	const fields = parseTicketFields(body);
	return fields && { ...fields, title: title.trim(), description, team };
}

/** The body of `PUT /api/ticket`: an issue identifier and at least one field to change, each of its own type. */
export function parseTicketEdit(body: unknown): TicketEdit | null {
	if (!isObject(body) || typeof body.id !== "string" || !TICKET_ID.test(body.id)) return null;
	const fields = parseTicketFields(body);
	return fields && Object.keys(fields).length > 0 ? { id: body.id, ...fields } : null;
}

/** The body of `PUT /api/ticket/attachment`: an issue identifier, a file name and MIME type, and its bytes in base64 within the size limit. */
export function parseTicketAttachment(body: unknown): TicketAttachmentUpload | null {
	if (!isObject(body)) return null;
	const { issue, name, type, data } = body;
	if (typeof issue !== "string" || !TICKET_ID.test(issue) || !isNonEmpty(name) || !isNonEmpty(type) || typeof data !== "string") return null;
	if (data.length > Math.ceil(MAX_TICKET_ATTACHMENT_BYTES / 3) * 4 || (data !== "" && !BASE64.test(data))) return null;
	return { issue, name, type, data };
}

export const SHA256 = /^[0-9a-f]{64}$/;

const worktreeTarget = (value: unknown): WorktreeTarget | null =>
	isObject(value) && isNonEmpty(value.repository) && isNonEmpty(value.path) ? { repository: value.repository, path: value.path } : null;

/** The body of `PUT /api/worktrees/removal`: a preview of up to 100 registered checkouts, or the confirmations from such a preview. */
export function parseWorktreeRemoval(body: unknown): WorktreeRemovalRequest | null {
	if (!isObject(body)) return null;
	if (body.action === "preview") {
		if (!Array.isArray(body.targets) || body.targets.length === 0 || body.targets.length > 100) return null;
		const targets: WorktreeTarget[] = [];
		for (const item of body.targets) {
			const target = worktreeTarget(item);
			if (!target) return null;
			targets.push(target);
		}
		return { action: "preview", targets };
	}
	if (body.action !== "remove" || !Array.isArray(body.plans) || body.plans.length === 0 || body.plans.length > 100) return null;
	const plans: WorktreeConfirmation[] = [];
	for (const item of body.plans) {
		const target = worktreeTarget(item);
		const confirmation = isObject(item) ? str(item.confirmation) : undefined;
		if (!target || !confirmation || !SHA256.test(confirmation)) return null;
		plans.push({ ...target, confirmation });
	}
	return { action: "remove", plans };
}

const isProjectOp = oneOf(["add", "hide", "show"] as const);

/** The body of `PUT /api/projects`: `{ op, cwd }`. Adding takes any path a new session takes; hiding and showing name an absolute directory. */
export function parseProjectChange(body: unknown): ProjectChange | null {
	if (!isObject(body) || !isProjectOp(body.op) || !isNonEmpty(body.cwd)) return null;
	return body.op === "add" || body.cwd.startsWith("/") ? { op: body.op, cwd: body.cwd } : null;
}
