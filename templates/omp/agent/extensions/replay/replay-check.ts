import { canonicalJson, sha256 } from "./request-log-reader";
import type { RequestCheck, ReplayMarker } from "../../../../../src/shared/replay";
import { normalizeRoots } from "./replay-paths";

/** Fields omp derives from the session, thread and turn ids; every fork gets fresh ones, and they are not model input. */
const SESSION_IDENTITY: Record<string, true> = { client_metadata: true, prompt_cache_key: true };

function normalizedBody(value: unknown, roots: readonly string[], model: string | null, changeModel: boolean, system = false): unknown {
	if (typeof value === "string") {
		let text = normalizeRoots(value, roots);
		if (system && changeModel && model) {
			const at = text.indexOf("<project-context>\n<workstation>");
			const end = at < 0 ? -1 : text.indexOf("</workstation>", at);
			const filesAt = text.indexOf("<file ");
			if (at >= 0 && end > at && (filesAt < 0 || at < filesAt)) {
				const line = new RegExp(`(^|\\n)- Model: (?:[a-z][\\w-]*/)?${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\r?$|\\n)`);
				text = text.slice(0, at) + text.slice(at, end).replace(line, "$1- Model: \0<model>") + text.slice(end);
			}
		}
		return text;
	}
	if (Array.isArray(value)) return value.map(item => normalizedBody(item, roots, model, changeModel, system));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, normalizedBody(field, roots, model, changeModel, system)]));
}
export function checkReplayRequest(marker: ReplayMarker, original: unknown, payload: unknown, api: string | null, model: string | null): RequestCheck {
	const originalRecord = marker.original;
	const replayHash = sha256(canonicalJson(payload));
	if (!originalRecord || original === null) return { status: "unknown", reason: "The original request is missing or its blobs could not be verified.", rawEqual: null, replayHash };
	const originalHash = sha256(canonicalJson(original));
	if (originalHash !== originalRecord.hash) return { status: "unknown", reason: "The original request does not rebuild to its logged SHA-256.", rawEqual: null, replayHash };
	if (!api || api !== originalRecord.api) return { status: "unknown", reason: "The provider APIs differ or were not recorded. Raw bodies may still be compared.", rawEqual: originalHash === replayHash, originalHash, replayHash };
	if (!original || typeof original !== "object" || Array.isArray(original) || !payload || typeof payload !== "object" || Array.isArray(payload)) return { status: "unknown", rawEqual: originalHash === replayHash, originalHash, replayHash, reason: "The hook did not expose complete request envelopes." };
	const originalBody = original as Record<string, unknown>;
	const replayBody = payload as Record<string, unknown>;
	const normalize = (body: Record<string, unknown>, roots: readonly string[], id: string | null): Record<string, unknown> => Object.fromEntries(Object.entries(body).map(([key, value]) => {
		if (marker.modelChanged && typeof value === "string" && (key === "model" || key === "modelId")) return [key, "\0<model>"];
		if (Object.hasOwn(SESSION_IDENTITY, key)) return [key, "\0<session>"];
		if ((key === "messages" || key === "input" || key === "contents") && Array.isArray(value)) return [key, value.map(item => normalizedBody(item, roots, id, marker.modelChanged, item?.role === "system" || item?.role === "developer"))];
		return [key, normalizedBody(value, roots, id, marker.modelChanged, key === "system" || key === "instructions" || key === "systemInstruction")];
	}));
	const left = normalize(originalBody, marker.roots.original, originalRecord.model);
	const right = normalize(replayBody, [marker.roots.replay], model);
	const normalizedOriginal = sha256(canonicalJson(left));
	const normalizedReplay = sha256(canonicalJson(right));
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	const differences = [...keys].filter(key => canonicalJson(left[key]) !== canonicalJson(right[key]));
	return { status: normalizedOriginal === normalizedReplay ? "match" : "mismatch", rawEqual: originalHash === replayHash, originalHash, replayHash, normalizedOriginal, normalizedReplay, differences };
}

/** Correlate with the last user message, not a quoted prompt in a classifier or title request. */
export function containsPrompt(payload: unknown, content: unknown): boolean {
	const textOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.flatMap(block => block && typeof block === "object" && "text" in block && typeof block.text === "string" ? [block.text] : []).join("") : "";
	if (!payload || typeof payload !== "object") return false;
	const expected = textOf(content);
	for (const key of ["messages", "input", "contents"]) {
		if (!(key in payload)) continue;
		const value = Reflect.get(payload, key);
		if (typeof value === "string" && expected && value === expected) return true;
		if (!Array.isArray(value)) continue;
		const user = value.findLast(item => item && typeof item === "object" && item.role === "user");
		if (!user) continue;
		const images = Array.isArray(content) ? content.filter(block => block && block.type === "image") : [];
		if (expected && !endsWithText(user.content ?? user.parts, expected)) continue;
		if (!expected && !images.length) continue;
		const serialized = canonicalJson(user);
		if (images.every(image => typeof image.data === "string" && serialized.includes(image.data))) return true;
	}
	return false;
}

/** omp prepends context blocks (a dated `<system-reminder>`) to the prompt's user message; the prompt is its trailing text blocks. */
function endsWithText(value: unknown, expected: string): boolean {
	if (typeof value === "string") return value === expected;
	if (!Array.isArray(value)) return false;
	const texts = value.flatMap(block => block && typeof block === "object" && "text" in block && typeof block.text === "string" ? [block.text] : []);
	return texts.some((_, start) => texts.slice(start).join("") === expected);
}
