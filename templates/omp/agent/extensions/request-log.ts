// Records every request omp sends to a model provider, so any turn can be rebuilt and its hash checked:
//   bun ~/.omp/agent/extensions/request-log.ts <session.jsonl>       checks every request in the session
//   bun ~/.omp/agent/extensions/request-log.ts <session.jsonl> <n>   prints request n's body
// Each request appends one small entry to the session file. The system prompt, the tools, the other parameters, and
// the messages go to omp's blob store, where a blob is written once and shared by every request and session that
// sends the same bytes. Messages are stored as edits against the session's previous request, so a turn stores only the
// messages it adds or changes, and the session file references every blob, which keeps `omp gc` from deleting them.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const RECORD_TYPE = "omp-request-log.record";

const SYSTEM_KEYS = ["system", "instructions", "systemInstruction"];
const MESSAGE_KEYS = ["messages", "input", "contents"];
const BLOB_PREFIX = "blob:sha256:";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Body = { [key: string]: Json };
/** `count` messages copied from the base request starting at index `from`, or one message the base did not send. */
type Edit = { from: number; count: number } | { add: Json };

interface RequestRecord {
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
function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, field: unknown) => {
		if (typeof field === "bigint") return field.toString();
		if (field === null || typeof field !== "object" || Array.isArray(field)) return field;
		const object = field as Record<string, unknown>;
		return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
	});
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function diffMessages(base: string[], hashes: string[], messages: Json[]): Edit[] {
	const firstIndex = new Map<string, number>();
	base.forEach((hash, index) => {
		if (!firstIndex.has(hash)) firstIndex.set(hash, index);
	});
	const edits: Edit[] = [];
	hashes.forEach((hash, index) => {
		const last = edits.at(-1);
		if (last && "from" in last && base[last.from + last.count] === hash) {
			last.count++;
			return;
		}
		const from = firstIndex.get(hash);
		edits.push(from === undefined ? { add: messages[index] } : { from, count: 1 });
	});
	return edits;
}

export default function requestLog(pi: ExtensionAPI) {
	const previous = new Map<string, { requestHash: string; key: string; hashes: string[] }>();

	// Synchronous from start to end, so concurrent requests of one session, such as a side turn, never interleave
	// their edits.
	pi.on("before_provider_request", (event, ctx) => {
		const text = canonicalJson(event.payload);
		const body = JSON.parse(text) as Json;
		if (body === null || typeof body !== "object" || Array.isArray(body)) {
			throw new Error("request-log: the provider request body is not a JSON object");
		}
		const requestHash = sha256(text);
		const sessions = ctx.sessionManager;
		// The body was parsed from canonical JSON, so plain JSON.stringify of any part is canonical too.
		const store = (part: Json) => {
			const bytes = JSON.stringify(part);
			return sessions.putBlobSync(Buffer.from(bytes), { hash: sha256(bytes) }).ref;
		};
		const take = (key: string | undefined): Body | null => {
			if (key === undefined) return null;
			const part = { [key]: body[key] };
			delete body[key];
			return part;
		};

		const system = take(SYSTEM_KEYS.find(key => key in body));
		const tools = take("tools" in body ? "tools" : undefined);
		const messagesKey = MESSAGE_KEYS.find(key => Array.isArray(body[key]));
		let messages: RequestRecord["messages"] = null;
		if (messagesKey !== undefined) {
			const items = body[messagesKey] as Json[];
			delete body[messagesKey];
			const hashes = items.map(item => sha256(JSON.stringify(item)));
			const sessionId = sessions.getSessionId();
			const prior = previous.get(sessionId);
			const base = prior?.key === messagesKey ? prior : undefined;
			messages = {
				key: messagesKey,
				base: base?.requestHash ?? null,
				edits: store(diffMessages(base?.hashes ?? [], hashes, items)),
			};
			previous.set(sessionId, { requestHash, key: messagesKey, hashes });
		}

		const record: RequestRecord = {
			requestHash,
			provider: ctx.model?.provider ?? null,
			api: ctx.model?.api ?? null,
			model: ctx.model?.id ?? null,
			thinkingLevel: pi.getThinkingLevel() ?? null,
			leafId: sessions.getLeafId(),
			systemPromptHash: system && store(system),
			toolsHash: tools && store(tools),
			paramsHash: store(body),
			messages,
		};
		pi.appendEntry(RECORD_TYPE, record);
	});
}

interface RebuiltRequest {
	record: RequestRecord;
	body?: Body;
	/** SHA-256 of the rebuilt body as canonical JSON; equals `record.requestHash` when the rebuild is exact. */
	hash?: string;
	error?: string;
}

/** Rebuilds every request a session file records, in file order. */
function rebuildRequests(sessionText: string, readBlob: (hash: string) => string): RebuiltRequest[] {
	const messagesByRequest = new Map<string, Json[]>();
	const read = (ref: string): Json => {
		if (!ref.startsWith(BLOB_PREFIX)) throw new Error(`not a blob reference: ${ref}`);
		return JSON.parse(readBlob(ref.slice(BLOB_PREFIX.length))) as Json;
	};
	const rebuilt: RebuiltRequest[] = [];
	for (const line of sessionText.split("\n")) {
		if (!line.includes(RECORD_TYPE)) continue;
		const entry = JSON.parse(line) as { type?: string; customType?: string; data?: RequestRecord };
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

if (import.meta.main) {
	const args = process.argv.slice(2);
	const blobsFlag = args.indexOf("--blobs");
	const blobsDir =
		blobsFlag === -1
			? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"), "blobs")
			: args.splice(blobsFlag, 2)[1];
	const [sessionPath, selected] = args;
	if (!sessionPath || !blobsDir) {
		console.error("usage: bun request-log.ts <session.jsonl[.gz]> [request number] [--blobs <dir>]");
		process.exit(2);
	}
	const raw = readFileSync(sessionPath);
	const sessionText = sessionPath.endsWith(".gz") ? Bun.gunzipSync(raw).toString() : raw.toString();
	const requests = rebuildRequests(sessionText, hash => readFileSync(join(blobsDir, hash), "utf8"));
	const matches = (request: RebuiltRequest) => request.hash === request.record.requestHash;

	if (selected !== undefined) {
		const request = requests[Number(selected) - 1];
		if (!request) {
			console.error(`request ${selected} not found; this session records ${requests.length}`);
			process.exit(1);
		}
		if (!matches(request)) {
			console.error(`request ${selected}: ${request.error ?? `rebuilt hash ${request.hash} differs from ${request.record.requestHash}`}`);
			process.exit(1);
		}
		console.log(canonicalJson(request.body));
	} else {
		requests.forEach((request, index) => {
			const { model, thinkingLevel, requestHash } = request.record;
			const status = matches(request) ? "ok" : (request.error ?? `rebuilt hash ${request.hash} differs`);
			console.log(`${index + 1}\t${model}\t${thinkingLevel}\t${requestHash.slice(0, 12)}\t${status}`);
		});
		const exact = requests.filter(matches).length;
		console.log(`${exact} of ${requests.length} requests rebuilt with a matching hash`);
		if (exact !== requests.length) process.exit(1);
	}
}
