// Records every request omp sends to a model provider, so any turn can be rebuilt and its hash checked:
//   bun ~/.omp/agent/extensions/request-log.ts <session.jsonl>       checks every request in the session
//   bun ~/.omp/agent/extensions/request-log.ts <session.jsonl> <n>   prints request n's body
// Each request appends one small entry to the session file. The system prompt, the tools, the other parameters, and
// the messages go to omp's blob store, where a blob is written once and shared by every request and session that
// sends the same bytes. Messages are stored as edits against the session's previous request, so a turn stores only the
// messages it adds or changes, and the session file references every blob, which keeps `omp gc` from deleting them.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { canonicalJson, rebuildRequests, RECORD_TYPE, sha256 } from "./replay/request-log-reader";
import type { Body, Edit, Json, RebuiltRequest, RequestRecord } from "./replay/request-log-reader";
export { canonicalJson, rebuildRequests } from "./replay/request-log-reader";

const SYSTEM_KEYS = ["system", "instructions", "systemInstruction"];
const MESSAGE_KEYS = ["messages", "input", "contents"];

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
