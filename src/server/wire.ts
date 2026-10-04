/**
 * What the page sends, checked before anything acts on it: the socket's messages and the HTTP routes' bodies and queries.
 * Each socket message has one parser in {@link clientParsers}, so a {@link ClientMsg} variant without one does not compile.
 * Socket parsers return `{ ok }` for a value, even a `null` one, and `null` for anything else, so no caller casts what it received.
 */
import { isObject } from "../json";
import { MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_TYPES } from "../shared";
import type { BranchChoice, ClientMsg, CompletionScope, LiveView, ModelOption, PromptImage, PullRequest, SessionLinksEdit, StartRequest, UserAnswer, View } from "../shared";

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

function parseStartRequest(value: Record<string, unknown>): Parsed<StartRequest> {
	switch (value.kind) {
		case "new": {
			const { cwd, prompt } = value;
			const images = parseImages(value.images);
			const branch = parseBranchChoice(value.branch);
			// `null` starts on omp's default model.
			const model = value.model === null || value.model === undefined ? { ok: null } : parseModel(value.model);
			const thinking = parseThinking(value.thinking);
			const skill = parseSkill(value.skill);
			if (!isNonEmpty(cwd) || typeof prompt !== "string" || !images || !branch || !model || !thinking || !skill) return null;
			return prompt.trim() || images.ok.length > 0
				? { ok: { kind: "new", cwd, prompt, images: images.ok, branch: branch.ok, model: model.ok, thinking: thinking.ok, skill: skill.ok } }
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
	answer(value) {
		const { instanceId, requestId } = value;
		const answer = parseAnswer(value.answer);
		return typeof instanceId === "string" && typeof requestId === "string" && answer ? { ok: { t: "answer", instanceId, requestId, answer: answer.ok } } : null;
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
