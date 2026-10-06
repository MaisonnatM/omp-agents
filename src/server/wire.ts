/**
 * What the page sends, checked before anything acts on it: the socket's messages and the HTTP routes' bodies and queries.
 * Each socket message has one parser in {@link clientParsers}, so a {@link ClientMsg} variant without one does not compile.
 * Socket parsers return `{ ok }` for a value, even a `null` one, and `null` for anything else, so no caller casts what it received.
 */
import { isObject, nonEmpty, oneOf, str } from "../json";
import { MAX_COMMAND_LENGTH, type RoutineChange, type RoutineTask, type Schedule, type Schedules, type Weekday } from "../routines";
import { GOOGLE_CLIENT_ID, type GoogleClient, MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_TYPES, TICKET_ID, TICKET_PRIORITIES } from "../shared";
import type {
	BranchChoice,
	ClientMsg,
	CompletionScope,
	LiveView,
	ModelOption,
	PromptImage,
	PullRequest,
	SessionLinksEdit,
	StartRequest,
	TicketDraft,
	TicketEdit,
	UserAnswer,
	View,
	WorkItem,
} from "../shared";
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
			return isNonEmpty(value.prompt) ? { ok: { kind: "prompt", prompt: value.prompt } } : null;
		case "command":
			return isNonEmpty(value.command) && value.command.length <= MAX_COMMAND_LENGTH ? { ok: { kind: "command", command: value.command } } : null;
		default:
			return null;
	}
}

/** What the page edits of a routine: all but its runs and its creation time, which the server keeps. */
export type RoutineSpec = Extract<RoutineChange, { op: "save" }>["routine"];

/** A routine as the page saves it, or `null` when a field is missing, of the wrong type, or out of range; other fields drop. */
export function parseRoutineSpec(value: unknown): RoutineSpec | null {
	if (!isObject(value)) return null;
	const { id, name, cwd, enabled } = value;
	const schedules = parseSchedules(value.schedules);
	const task = parseRoutineTask(value.task);
	const skill = parseSkill(value.skill);
	if (!isNonEmpty(id) || !isNonEmpty(name) || !isNonEmpty(cwd) || typeof enabled !== "boolean" || !schedules || !task || !skill) return null;
	return { id, name, cwd, schedules: schedules.ok, task: task.ok, skill: skill.ok, enabled };
}

function parseRoutineChange(value: unknown): Parsed<RoutineChange> {
	if (!isObject(value)) return null;
	const { op } = value;
	if (op === "save") {
		const routine = parseRoutineSpec(value.routine);
		return routine && { ok: { op, routine } };
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
		const { reqId, messages } = value;
		return view &&
			isCounter(reqId) &&
			Array.isArray(messages) &&
			messages.every((m): m is { queue: "steering" | "followUp"; text: string } =>
				isObject(m) && (m.queue === "steering" || m.queue === "followUp") && typeof m.text === "string")
			? { ok: { t: "dequeue", reqId, view: view.ok, messages } }
			: null;
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
	abort: ({ instanceId }) => (typeof instanceId === "string" ? { ok: { t: "abort", instanceId } } : null),
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

/** A pull request named by an owner, repository, and number, as the routes that take one receive them. */
export function parsePullRequest(owner: unknown, repo: unknown, number: unknown): PullRequest | null {
	if (typeof owner !== "string" || typeof repo !== "string" || !NAME.test(owner) || !NAME.test(repo)) return null;
	return typeof number === "number" && Number.isSafeInteger(number) && number >= 1 ? { owner, repo, number } : null;
}

/** `?owner=<o>&repo=<r>&number=<n>` of `GET /api/pull-request`. */
export function parsePullRequestQuery(params: URLSearchParams): PullRequest | null {
	return parsePullRequest(params.get("owner"), params.get("repo"), Number(params.get("number")));
}

/** The body of `PUT /api/pull-request/sessions`: a pull request and at least one session id. */
export function parseSessionLinks(body: unknown): SessionLinksEdit | null {
	if (!isObject(body)) return null;
	const pr = parsePullRequest(body.owner, body.repo, body.number);
	const { sessionIds } = body;
	if (!pr || !Array.isArray(sessionIds) || sessionIds.length === 0) return null;
	return sessionIds.every((id): id is string => typeof id === "string") ? { ...pr, sessionIds } : null;
}

/** The body of `PUT /api/google/client`: a desktop OAuth client's ID and secret, as Google Cloud's console shows them. */
export function parseGoogleClient(body: unknown): GoogleClient | null {
	if (!isObject(body) || !isNonEmpty(body.clientId) || !isNonEmpty(body.clientSecret)) return null;
	const clientId = body.clientId.trim();
	return GOOGLE_CLIENT_ID.test(clientId) ? { clientId, clientSecret: body.clientSecret.trim() } : null;
}

const isTicketPriority = oneOf(TICKET_PRIORITIES);

/** The body of `PUT /api/ticket/new`: a title and a description, each within its limit, and a team by id. */
export function parseTicketDraft(body: unknown): TicketDraft | null {
	if (!isObject(body)) return null;
	const { title, description, team } = body;
	if (!isNonEmpty(title) || title.length > MAX_TICKET_TITLE || typeof description !== "string" || description.length > MAX_TICKET_DESCRIPTION || !isNonEmpty(team)) return null;
	return { title: title.trim(), description, team };
}

/** The body of `PUT /api/ticket`: an issue identifier and at least one field to change, each of its own type. */
export function parseTicketEdit(body: unknown): TicketEdit | null {
	if (!isObject(body) || typeof body.id !== "string" || !TICKET_ID.test(body.id)) return null;
	const { state, assignee, priority, labels, project, dueDate } = body;
	const edit: TicketEdit = { id: body.id };
	if (state !== undefined) {
		if (!isNonEmpty(state)) return null;
		edit.state = state;
	}
	if (assignee !== undefined) {
		if (assignee !== null && !isNonEmpty(assignee)) return null;
		edit.assignee = assignee;
	}
	if (priority !== undefined) {
		if (!isTicketPriority(priority)) return null;
		edit.priority = priority;
	}
	if (labels !== undefined) {
		if (!Array.isArray(labels) || !labels.every(isNonEmpty)) return null;
		edit.labels = [...new Set(labels)];
	}
	if (project !== undefined) {
		if (project !== null && !isNonEmpty(project)) return null;
		edit.project = project;
	}
	if (dueDate !== undefined) {
		if (dueDate !== null && !isDay(dueDate)) return null;
		edit.dueDate = dueDate;
	}
	return Object.keys(edit).length > 1 ? edit : null;
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
