/**
 * Questions a live session waits on, from either transport: omp's RPC `extension_ui_request`
 * frames for dashboard sessions and Collab `ui-request` frames for terminal sessions.
 */
import { isObject, str } from "./json";
import type { RequestOption, UserAnswer, UserRequest } from "./shared/sessions";

function parseOptions(options: unknown, details: unknown): RequestOption[] | null {
	if (!Array.isArray(options)) return null;
	const rows: RequestOption[] = [];
	for (const [index, option] of options.entries()) {
		// Collab rows are a label or `{ label, description }`; RPC rows are labels with descriptions alongside.
		const label = typeof option === "string" ? option : isObject(option) ? str(option.label) : undefined;
		if (label === undefined) return null;
		const detail = isObject(option) ? option : Array.isArray(details) && isObject(details[index]) ? details[index] : null;
		const description = detail ? str(detail.description)?.trim() || null : null;
		rows.push({ label, description });
	}
	return rows;
}

/** What one RPC `extension_ui_request` does to the pending questions, or `null` for frames that ask nothing. */
export type RpcRequestChange = { kind: "add"; request: UserRequest } | { kind: "cancel"; id: string } | null;

/** omp's `RpcExtensionUIRequest` (src/modes/rpc/rpc-types.ts), received at `now`. */
export function parseRpcRequest(frame: Record<string, unknown>, now: number): RpcRequestChange {
	const id = str(frame.id);
	if (id === undefined) return null;
	if (frame.method === "cancel") {
		const target = str(frame.targetId);
		return target === undefined ? null : { kind: "cancel", id: target };
	}
	const title = str(frame.title);
	if (title === undefined) return null;
	const deadline = typeof frame.timeout === "number" && frame.timeout > 0 ? now + frame.timeout : null;
	const base = { id, title, deadline };
	switch (frame.method) {
		case "select": {
			const options = parseOptions(frame.options, frame.optionDetails);
			return options ? { kind: "add", request: { ...base, kind: "select", options, checked: [] } } : null;
		}
		case "confirm":
			return { kind: "add", request: { ...base, kind: "confirm", message: str(frame.message) ?? "" } };
		case "input":
			return {
				kind: "add",
				request: { ...base, kind: "text", multiline: false, placeholder: str(frame.placeholder) ?? null, prefill: "" },
			};
		case "editor":
			return {
				kind: "add",
				request: { ...base, kind: "text", multiline: true, placeholder: null, prefill: str(frame.prefill) ?? "" },
			};
		default:
			return null;
	}
}

/** omp's `RpcExtensionUIResponse` for `answer` to request `id`. */
export function rpcResponse(id: string, answer: UserAnswer): Record<string, unknown> {
	switch (answer.kind) {
		case "value":
			return { type: "extension_ui_response", id, value: answer.value };
		case "confirm":
			return { type: "extension_ui_response", id, confirmed: answer.confirmed };
		case "cancel":
			return { type: "extension_ui_response", id, cancelled: true };
	}
}

/** A Collab `CollabUiRequest` (pi-wire); only writable guests receive one. */
export function parseCollabRequest(value: unknown): UserRequest | null {
	if (!isObject(value) || typeof value.reqId !== "number") return null;
	const title = str(value.title);
	if (title === undefined) return null;
	const base = { id: String(value.reqId), title, deadline: null };
	if (value.kind === "editor") {
		return { ...base, kind: "text", multiline: true, placeholder: null, prefill: str(value.prefill) ?? "" };
	}
	if (value.kind !== "select") return null;
	const options = parseOptions(value.options, null);
	if (!options) return null;
	const checked =
		value.selectionMarker === "checkbox" && Array.isArray(value.checkedIndices)
			? value.checkedIndices.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < options.length)
			: [];
	return { ...base, kind: "select", options, checked };
}

/** Whether `answer` is a reply `request` can take: one of its rows, text for a text field, yes or no for a confirm. */
function fits(request: UserRequest, answer: UserAnswer): boolean {
	if (answer.kind === "cancel") return true;
	switch (request.kind) {
		case "select":
			return answer.kind === "value" && request.options.some(option => option.label === answer.value);
		case "text":
			return answer.kind === "value";
		case "confirm":
			return answer.kind === "confirm";
	}
}

/** One session's pending questions in arrival order. A question with a deadline leaves on its own when omp stops waiting. */
export class PendingRequests {
	#pending = new Map<string, { request: UserRequest; timer: NodeJS.Timeout | undefined }>();
	readonly #onChange: () => void;

	constructor(onChange: () => void) {
		this.#onChange = onChange;
	}

	list(): UserRequest[] {
		return [...this.#pending.values()].map(entry => entry.request);
	}

	/** A request with a known id replaces the old copy in place. */
	add(request: UserRequest): void {
		clearTimeout(this.#pending.get(request.id)?.timer);
		const timer = request.deadline === null ? undefined : setTimeout(() => this.remove(request.id), Math.max(0, request.deadline - Date.now()));
		this.#pending.set(request.id, { request, timer });
		this.#onChange();
	}

	/** Removes request `id` when it is pending and can take `answer`; the caller then sends the answer. */
	take(id: string, answer: UserAnswer): boolean {
		const entry = this.#pending.get(id);
		if (!entry || !fits(entry.request, answer)) return false;
		this.remove(id);
		return true;
	}

	remove(id: string): void {
		const entry = this.#pending.get(id);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.#pending.delete(id);
		this.#onChange();
	}

	clear(): void {
		if (this.#pending.size === 0) return;
		for (const entry of this.#pending.values()) clearTimeout(entry.timer);
		this.#pending.clear();
		this.#onChange();
	}
}
