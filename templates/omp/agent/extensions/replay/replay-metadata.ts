import type { ReplayMarker, RequestCheck } from "../../../../../src/shared/replay";

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate the durable marker before a saved file can arm a guard or become a comparison. */
export function replayMarkerOf(value: unknown): ReplayMarker | null {
	if (!isObject(value) || value.v !== 1 || typeof value.id !== "string" || !isObject(value.source) || !isObject(value.roots) || !isObject(value.base) || !isObject(value.model)) return null;
	if (typeof value.source.sessionId !== "string" || typeof value.source.file !== "string" || typeof value.source.turnId !== "string" || typeof value.source.at !== "number" || !Number.isFinite(value.source.at)) return null;
	if (!Array.isArray(value.roots.original) || !value.roots.original.every(root => typeof root === "string" && root.startsWith("/")) || typeof value.roots.replay !== "string" || !value.roots.replay.startsWith("/")) return null;
	if (typeof value.base.sha !== "string" || !/^[a-f0-9]{40,64}$/.test(value.base.sha) || value.base.how !== "reflog" && value.base.how !== "head-now" || typeof value.model.provider !== "string" || typeof value.model.id !== "string") return null;
	if (value.thinking !== null && typeof value.thinking !== "string" || typeof value.promptEdited !== "boolean" || typeof value.repaired !== "boolean" || typeof value.modelChanged !== "boolean" || typeof value.originalTurnRef !== "string" || !/^blob:sha256:[a-f0-9]{64}$/.test(value.originalTurnRef)) return null;
	if (value.original !== null && (!isObject(value.original) || value.original.api !== null && typeof value.original.api !== "string" || value.original.model !== null && typeof value.original.model !== "string" || typeof value.original.hash !== "string" || !/^[a-f0-9]{64}$/.test(value.original.hash) || typeof value.original.bodyRef !== "string" || !/^blob:sha256:[a-f0-9]{64}$/.test(value.original.bodyRef))) return null;
	return value as unknown as ReplayMarker;
}

export function requestCheckOf(value: unknown): RequestCheck | null {
	if (!isObject(value) || value.rawEqual !== null && typeof value.rawEqual !== "boolean") return null;
	if (value.status === "unknown") {
		if (typeof value.reason !== "string" || value.originalHash !== undefined && (typeof value.originalHash !== "string" || !/^[a-f0-9]{64}$/.test(value.originalHash)) || value.replayHash !== undefined && (typeof value.replayHash !== "string" || !/^[a-f0-9]{64}$/.test(value.replayHash))) return null;
		return value as unknown as RequestCheck;
	}
	if ((value.status !== "match" && value.status !== "mismatch") || typeof value.rawEqual !== "boolean" || !Array.isArray(value.differences) || !value.differences.every(key => typeof key === "string")) return null;
	if (![value.originalHash, value.replayHash, value.normalizedOriginal, value.normalizedReplay].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) return null;
	return value as unknown as RequestCheck;
}
