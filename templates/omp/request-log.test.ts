import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDir } from "../../src/omp/install";

const extensionPath = join(import.meta.dir, "agent/extensions/request-log.ts");

// Runs the extension against omp's real blob store and writes its entries the way omp appends custom entries.
const loader = `
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [packageDir, extensionPath, inputPath] = process.argv.slice(2);
const { BlobStore } = await import(join(packageDir, "src/session/blob-store.ts"));
const { default: extension } = await import(extensionPath);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const blobs = new BlobStore(input.blobsDir);
const lines = [];
let handler;
let leaf = null;
extension({
	on(name, registered) { if (name === "before_provider_request") handler = registered; },
	getThinkingLevel: () => "high",
	appendEntry(customType, data) {
		const id = String(lines.length + 1).padStart(8, "0");
		lines.push(JSON.stringify({ type: "custom", customType, data, id, parentId: leaf, timestamp: new Date().toISOString() }));
		leaf = id;
	},
});
const results = [];
for (const { sessionId, model, payload } of input.requests) {
	const sent = JSON.stringify(payload);
	const sessionManager = {
		getSessionId: () => sessionId,
		getLeafId: () => leaf,
		putBlobSync: (data, options) => blobs.putSync(data, options),
	};
	const returned = await handler({ type: "before_provider_request", payload }, { model, sessionManager });
	results.push({ returned: returned ?? null, unchanged: JSON.stringify(payload) === sent });
}
writeFileSync(input.sessionPath, lines.join("\\n") + "\\n");
console.log(JSON.stringify(results));
`;

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Request {
	sessionId: string;
	model: { provider: string; api: string; id: string };
	payload: Record<string, unknown>;
}

function record(requests: Request[]) {
	const root = mkdtempSync(join(tmpdir(), "request-log-"));
	roots.push(root);
	const blobsDir = join(root, "blobs");
	const sessionPath = join(root, "session.jsonl");
	const inputPath = join(root, "input.json");
	writeFileSync(inputPath, JSON.stringify({ requests, blobsDir, sessionPath }));
	const child = Bun.spawnSync([process.execPath, "run", "-", packageDir, extensionPath, inputPath], {
		stdin: Buffer.from(loader), stdout: "pipe", stderr: "pipe",
	});
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	const results = JSON.parse(child.stdout.toString()) as Array<{ returned: unknown; unchanged: boolean }>;
	return { blobsDir, sessionPath, results };
}

function check(sessionPath: string, blobsDir: string, ...args: string[]) {
	const child = Bun.spawnSync([process.execPath, extensionPath, sessionPath, ...args, "--blobs", blobsDir], { stdout: "pipe", stderr: "pipe" });
	return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

const claude = { provider: "anthropic", api: "anthropic-messages", id: "claude-opus-5-5" };
const codex = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5" };
const marker = { type: "ephemeral" };
const readTool = { name: "read", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const grepTool = { name: "grep", description: "Search files", input_schema: { type: "object", properties: { pattern: { type: "string" } } } };

function text(role: string, body: string, cached = false) {
	return { role, content: [{ type: "text", text: body, ...(cached ? { cache_control: marker } : {}) }] };
}

function claudeRequest(sessionId: string, messages: object[], tools: object[] = [readTool]): Request {
	return {
		sessionId,
		model: claude,
		payload: {
			model: claude.id,
			max_tokens: 32000,
			stream: true,
			thinking: { type: "adaptive" },
			system: [{ type: "text", text: "You are omp.", cache_control: { ...marker, ttl: "1h" } }],
			tools,
			messages,
		},
	};
}

// The tail marker moves forward every turn, as omp's Anthropic prompt caching does.
function conversation(sessionId: string, turns: number, size = 200): Request[] {
	const requests: Request[] = [];
	const settled: object[] = [];
	for (let turn = 1; turn <= turns; turn++) {
		const prompt = `turn ${turn}: ${"x".repeat(size)}`;
		requests.push(claudeRequest(sessionId, [...settled, text("user", prompt, true)]));
		settled.push(text("user", prompt), text("assistant", `answer ${turn}`));
	}
	return requests;
}

describe("request log", () => {
	test("every recorded request rebuilds to the body omp sent and hashes to its logged hash", () => {
		const [first, second, third] = conversation("main", 3);
		const reminded = claudeRequest("main", [text("user", "look at a.ts\n<date>tomorrow</date>"), ...(third.payload.messages as object[]).slice(1)]);
		const newTool = claudeRequest("main", reminded.payload.messages as object[], [readTool, grepTool]);
		const sideSession = claudeRequest("side", [text("user", "an unrelated subagent task", true)]);
		const fallback: Request = {
			sessionId: "main",
			model: codex,
			payload: {
				model: codex.id,
				instructions: "You are omp.",
				input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "look at a.ts" }] }],
				tools: [{ type: "function", name: "read", parameters: readTool.input_schema }],
				reasoning: { effort: "high" },
				store: false,
			},
		};
		const requests = [first, second, sideSession, third, reminded, newTool, fallback];
		const { blobsDir, sessionPath, results } = record(requests);

		expect(results).toEqual(requests.map(() => ({ returned: null, unchanged: true })));
		const summary = check(sessionPath, blobsDir);
		expect(summary.code).toBe(0);
		expect(summary.stdout).toContain(`${requests.length} of ${requests.length} requests rebuilt with a matching hash`);
		requests.forEach((request, index) => {
			const printed = check(sessionPath, blobsDir, String(index + 1));
			expect(printed.code).toBe(0);
			expect(JSON.parse(printed.stdout)).toEqual(request.payload);
		});
	});

	test("a long conversation stores what each turn adds, not the context it sends again", () => {
		const turns = 20;
		const size = 10_000;
		const requests = conversation("main", turns, size);
		const { blobsDir, sessionPath } = record(requests);

		const sent = requests.reduce((total, request) => total + JSON.stringify(request.payload).length, 0);
		const stored = readdirSync(blobsDir).reduce((total, name) => total + statSync(join(blobsDir, name)).size, 0);
		expect(sent).toBeGreaterThan(turns * turns * size / 2);
		// A prompt is stored once as the marked tail and once more after the marker moves past it.
		expect(stored).toBeLessThan(3 * turns * size);
		expect(statSync(sessionPath).size).toBeLessThan(turns * 1_000);
		expect(check(sessionPath, blobsDir).code).toBe(0);
	});

	test("a request whose stored parts changed fails the check", () => {
		const { blobsDir, sessionPath } = record(conversation("main", 2));
		const toolsRef = readFileSync(sessionPath, "utf8").match(/"toolsHash":"blob:sha256:([a-f0-9]{64})"/)?.[1];
		if (!toolsRef) throw new Error("no tools blob recorded");
		writeFileSync(join(blobsDir, toolsRef), JSON.stringify({ tools: [grepTool] }));

		const summary = check(sessionPath, blobsDir);
		expect(summary.code).toBe(1);
		expect(summary.stdout).toContain("0 of 2 requests rebuilt with a matching hash");
		expect(check(sessionPath, blobsDir, "1").code).toBe(1);
	});
});
