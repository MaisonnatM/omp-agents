/**
 * What the page sends, checked before anything acts on it: the socket's messages and the HTTP routes' bodies and queries.
 * Each parser returns a typed value, or `null` for anything else, so no caller casts what it received.
 */
import { isObject } from "../json";
import { MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_TYPES } from "../shared";
import type { BranchChoice, ClientMsg, CompletionScope, LiveView, ModelOption, PromptImage, PullRequest, SessionLinksEdit, StartRequest, UserAnswer, View } from "../shared";

/** The longest composer text the server completes. */
const MAX_COMPLETION_TEXT = 4096;
/** GitHub's owner and repository names. */
const NAME = /^[\w.-]+$/;

const isCounter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function parseLiveView(value: unknown): LiveView | null {
	if (!isObject(value) || value.kind !== "live") return null;
	const { instanceId, agentId } = value;
	if (typeof instanceId !== "string" || (agentId !== null && typeof agentId !== "string")) return null;
	return { kind: "live", instanceId, agentId };
}

function parseView(value: unknown): View | null {
	if (isObject(value) && value.kind === "past") {
		return typeof value.sessionId === "string" ? { kind: "past", sessionId: value.sessionId } : null;
	}
	return parseLiveView(value);
}

function parseCompletionScope(value: unknown): CompletionScope | null {
	if (isObject(value) && value.kind === "new") {
		return isNonEmpty(value.cwd) ? { kind: "new", cwd: value.cwd } : null;
	}
	const view = isObject(value) && value.kind === "live" ? parseLiveView(value.view) : null;
	return view && { kind: "live", view };
}

function parseAnswer(value: unknown): UserAnswer | null {
	if (!isObject(value)) return null;
	if (value.kind === "cancel") return { kind: "cancel" };
	if (value.kind === "value" && typeof value.value === "string") return { kind: "value", value: value.value };
	if (value.kind === "confirm" && typeof value.confirmed === "boolean") return { kind: "confirm", confirmed: value.confirmed };
	return null;
}

/** `null` for no branch; `undefined` for a value that is not one. */
function parseBranchChoice(value: unknown): BranchChoice | null | undefined {
	if (value === null || value === undefined) return null;
	if (!isObject(value) || !isNonEmpty(value.name)) return undefined;
	if (value.kind === "existing") return { kind: "existing", name: value.name };
	return value.kind === "new" && isNonEmpty(value.base) ? { kind: "new", name: value.name, base: value.base } : undefined;
}

function parseModel(value: unknown): ModelOption | null {
	return isObject(value) && isNonEmpty(value.provider) && isNonEmpty(value.id) ? { provider: value.provider, id: value.id } : null;
}

/** The longest base64 of {@link MAX_PROMPT_IMAGE_BYTES}. */
const MAX_PROMPT_IMAGE_BASE64 = Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A prompt's images: `[]` when it sends none, `null` for anything but images of {@link PROMPT_IMAGE_TYPES} within the size limit. */
function parseImages(value: unknown): PromptImage[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const images: PromptImage[] = [];
	let size = 0;
	for (const image of value) {
		if (!isObject(image) || typeof image.data !== "string" || typeof image.mimeType !== "string") return null;
		if (!PROMPT_IMAGE_TYPES.includes(image.mimeType) || !BASE64.test(image.data)) return null;
		size += image.data.length;
		images.push({ data: image.data, mimeType: image.mimeType });
	}
	return size <= MAX_PROMPT_IMAGE_BASE64 ? images : null;
}

/** `null` for none, which keeps omp's thinking level; `undefined` for a value that is not a level. */
function parseThinking(value: unknown): string | null | undefined {
	if (value === null || value === undefined) return null;
	return isNonEmpty(value) ? value : undefined;
}

/** `null` for no pinned skill; `undefined` for a value that is not one token, as `/skill:<name>` takes a name. */
function parseSkill(value: unknown): string | null | undefined {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && /^\S+$/.test(value) ? value : undefined;
}

function parseStartRequest(value: Record<string, unknown>): StartRequest | null {
	switch (value.kind) {
		case "new": {
			const { cwd, prompt } = value;
			const images = parseImages(value.images);
			const branch = parseBranchChoice(value.branch);
			// `null` starts on omp's default model.
			const model = value.model === null || value.model === undefined ? null : (parseModel(value.model) ?? undefined);
			const thinking = parseThinking(value.thinking);
			const skill = parseSkill(value.skill);
			if (!isNonEmpty(cwd) || typeof prompt !== "string" || !images || branch === undefined || model === undefined || thinking === undefined || skill === undefined) return null;
			return prompt.trim() || images.length > 0 ? { kind: "new", cwd, prompt, images, branch, model, thinking, skill } : null;
		}
		case "fork": {
			const view = parseView(value.view);
			const { entryId } = value;
			return view && typeof entryId === "string" && entryId ? { kind: "fork", view, entryId } : null;
		}
		case "resume": {
			const { sessionId } = value;
			return typeof sessionId === "string" && sessionId ? { kind: "resume", sessionId } : null;
		}
		default:
			return null;
	}
}

/** A socket message from the page, or `null` when it is not valid JSON or not one of {@link ClientMsg}. */
export function parseClientMsg(raw: string | Buffer): ClientMsg | null {
	let value: unknown;
	try {
		value = JSON.parse(String(raw));
	} catch {
		return null;
	}
	if (!isObject(value)) return null;
	switch (value.t) {
		case "watch": {
			if (!Array.isArray(value.views)) return null;
			const views = value.views.map(parseView);
			return views.every(view => view !== null) ? { t: "watch", views } : null;
		}
		case "prompt": {
			const view = parseLiveView(value.view);
			const { text, delivery } = value;
			const images = parseImages(value.images);
			if (!view || typeof text !== "string" || !images || (delivery !== "steer" && delivery !== "followUp")) return null;
			return text.trim() || images.length > 0 ? { t: "prompt", view, text, images, delivery } : null;
		}
		case "dequeue": {
			const view = parseLiveView(value.view);
			const { reqId, messages } = value;
			return view &&
				isCounter(reqId) &&
				Array.isArray(messages) &&
				messages.every((m): m is { queue: "steering" | "followUp"; text: string } =>
					isObject(m) && (m.queue === "steering" || m.queue === "followUp") && typeof m.text === "string")
				? { t: "dequeue", reqId, view, messages }
				: null;
		}
		case "complete": {
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
				? { t: "complete", reqId, scope, text, cursor }
				: null;
		}
		case "abort":
		case "end":
		case "list-models": {
			const id = value.instanceId;
			return typeof id === "string" ? { t: value.t, instanceId: id } : null;
		}
		case "start": {
			const request = parseStartRequest(value);
			return isCounter(value.reqId) && request ? { t: "start", reqId: value.reqId, ...request } : null;
		}
		case "set-model": {
			const { instanceId } = value;
			const model = parseModel(value.model);
			const thinking = parseThinking(value.thinking);
			return typeof instanceId === "string" && model && thinking !== undefined ? { t: "set-model", instanceId, model, thinking } : null;
		}
		case "set-thinking": {
			const { instanceId, level } = value;
			return typeof instanceId === "string" && typeof level === "string" ? { t: "set-thinking", instanceId, level } : null;
		}
		case "answer": {
			const { instanceId, requestId } = value;
			const answer = parseAnswer(value.answer);
			return typeof instanceId === "string" && typeof requestId === "string" && answer ? { t: "answer", instanceId, requestId, answer } : null;
		}
		case "cancel-agent": {
			const view = parseLiveView(value.view);
			return view?.agentId ? { t: "cancel-agent", view: { ...view, agentId: view.agentId } } : null;
		}
		case "resume-all": {
			const { reqId, sessionIds } = value;
			if (!isCounter(reqId) || !Array.isArray(sessionIds) || sessionIds.length === 0) return null;
			return sessionIds.every(isNonEmpty) ? { t: "resume-all", reqId, sessionIds: [...new Set(sessionIds)] } : null;
		}
		case "dismiss-interrupted": {
			const { sessionId } = value;
			return isNonEmpty(sessionId) ? { t: "dismiss-interrupted", sessionId } : null;
		}
		default:
			return null;
	}
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
