import { createHash } from "node:crypto";

export const RECORD_TYPE = "omp-request-log.record";
const BLOB_PREFIX = "blob:sha256:";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Body = { [key: string]: Json };
/** `count` messages copied from the base request starting at index `from`, or one message the base did not send. */
export type Edit = { from: number; count: number } | { add: Json };

export interface RequestRecord {
	/** SHA-256 of the request body as canonical JSON. */
	requestHash: string;
	provider: string | null;
	api: string | null;
	model: string | null;
	thinkingLevel: string | null;
	/** The session entry the request was built from; its ancestors are the entries in the context. */
	leafId: string | null;
	/** Blob holding `{ <system field>: value }`; the field is `system`, `instructions`, or `systemInstruction`. */
	systemPromptHash: string | null;
	/** Blob holding `{ tools: value }`, in the order the provider receives them. */
	toolsHash: string | null;
	/** Blob holding every other top-level field of the body. */
	paramsHash: string;
	/** Blob holding the edits that turn the base request's messages into this request's `key` field. */
	messages: { key: string; base: string | null; edits: string } | null;
}

/** JSON with every object's keys sorted, so equal bodies hash equally whatever order a provider built them in. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, field: unknown) => {
		if (typeof field === "bigint") return field.toString();
		if (field === null || typeof field !== "object" || Array.isArray(field)) return field;
		const object = field as Record<string, unknown>;
		return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
	});
}

export function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}
export interface RebuiltRequest {
	record: RequestRecord;
	body?: Body;
	/** SHA-256 of the rebuilt body as canonical JSON; equals `record.requestHash` when the rebuild is exact. */
	hash?: string;
	error?: string;
}

/** Rebuilds every request a session file records, in file order. */
export function rebuildRequests(sessionText: string, readBlob: (hash: string) => string): RebuiltRequest[] {
	const messagesByRequest = new Map<string, Json[]>();
	const read = (ref: string): Json => {
		if (!/^blob:sha256:[a-f0-9]{64}$/.test(ref)) throw new Error(`not a blob reference: ${ref}`);
		return JSON.parse(readBlob(ref.slice(BLOB_PREFIX.length))) as Json;
	};
	const rebuilt: RebuiltRequest[] = [];
	for (const line of sessionText.split("\n")) {
		if (!line.includes(RECORD_TYPE)) continue;
		let entry: { type?: string; customType?: string; data?: RequestRecord };
		try { entry = JSON.parse(line); } catch { continue; }
		if (entry.type !== "custom" || entry.customType !== RECORD_TYPE || !entry.data) continue;
		const record = entry.data;
		try {
			const body: Body = {};
			for (const ref of [record.paramsHash, record.systemPromptHash, record.toolsHash]) {
				if (ref !== null) Object.assign(body, read(ref));
			}
			if (record.messages) {
				const { key, base, edits } = record.messages;
				const baseMessages = base === null ? [] : messagesByRequest.get(base);
				if (!baseMessages) throw new Error(`base request ${base} is not recorded earlier in this file`);
				const items: Json[] = [];
				for (const edit of read(edits) as Edit[]) {
					if ("add" in edit) items.push(edit.add);
					else items.push(...baseMessages.slice(edit.from, edit.from + edit.count));
				}
				messagesByRequest.set(record.requestHash, items);
				body[key] = items;
			}
			rebuilt.push({ record, body, hash: sha256(canonicalJson(body)) });
		} catch (error) {
			rebuilt.push({ record, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return rebuilt;
}
