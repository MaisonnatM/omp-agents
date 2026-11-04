import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { sessionContext, sessionManager } from "../../src/omp/modules";
import { placeholder, Redactor } from "./agent/extensions/redact-secrets/redact";
import { canonicalJson, rebuildRequests, RECORD_TYPE, sha256 } from "./agent/extensions/replay/request-log-reader";

// The extension imports omp's types, which the type check cannot resolve, so it is loaded by path.
const { default: extension, dataDir } = await import(join(import.meta.dir, "agent/extensions/redact-secrets.ts"));

// Each key is put together at run time, so the repository holds no string a secret scanner would take for a real key.
const STRIPE = ["sk", "live", "TESTONLY4eC39HqLyjWDarjtT1zdp7dc"].join("_");
const PUBLISHABLE = ["pk", "live", "TESTONLY51HzP2bGk9qXr7"].join("_");
const GITHUB = ["ghp", "TESTONLYa1b2c3d4e5f6g7h8i9j0k1l2m3n4"].join("_");
const ANTHROPIC = ["sk", "ant", "api03", "TESTONLYabcdefghijklmnop"].join("-");
const OPENAI = ["sk", "proj", "TESTONLYabcdefghijklmnopqrst"].join("-");
const SUPABASE = ["sb", "secret", "TESTONLYabcdefghijklmnop"].join("_");
const AWS_ID = ["AKIA", "TESTONLY12345678"].join("");
const AWS_SECRET = ["wJalrXUtnFEMI/K7MDENG/bPxRfiCY", "TESTONLYK1"].join("");
const GOOGLE = ["GOCSPX", "TESTONLYabcdefghijklmnop"].join("-");
const DB_PASSWORD = ["TESTONLY", "pgPass42"].join("");
const DB_URL = `postgresql://app:${DB_PASSWORD}@db.example.com:5432/app`;
const PASSWORD = ["TESTONLY", "hunter22"].join("");
const SECRETS = [STRIPE, PUBLISHABLE, GITHUB, ANTHROPIC, OPENAI, SUPABASE, AWS_ID, AWS_SECRET, GOOGLE, DB_PASSWORD, PASSWORD];

const PROMPT = [
	`Set STRIPE_SECRET_KEY=${STRIPE} and the publishable key ${PUBLISHABLE}.`,
	`GitHub ${GITHUB}, Anthropic ${ANTHROPIC}, OpenAI ${OPENAI}, Supabase ${SUPABASE}, Google ${GOOGLE}.`,
	`AWS ${AWS_ID} ${AWS_SECRET}`,
	`Database ${DB_URL}, admin password: "${PASSWORD}"`,
].join("\n");

const roots: string[] = [];
const agentDir = process.env.PI_CODING_AGENT_DIR!;
const historyDb = join(agentDir, "history.db");
/** Removes `history.db` and its log, which an earlier test file in the same process can leave in the shared agent directory. */
function removeHistory(): void {
	for (const suffix of ["", "-wal", "-shm"]) rmSync(historyDb + suffix, { force: true });
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	removeHistory();
});

/** The secrets in `bytes`, by their text. */
function leaked(bytes: Buffer | string): string[] {
	const text = bytes.toString();
	return SECRETS.filter(secret => text.includes(secret));
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(child => (child.isDirectory() ? filesUnder(join(dir, child.name)) : [join(dir, child.name)]));
}

/** omp's `history.db` as its history and session index write it, in WAL mode, with the session's prompt, title, and recap. */
function seedHistory(sessionId: string): void {
	removeHistory();
	const db = new Database(historyDb);
	db.run("PRAGMA journal_mode = WAL");
	db.run(`
CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL DEFAULT 0, cwd TEXT, session_id TEXT, use_count INTEGER NOT NULL DEFAULT 1);
CREATE VIRTUAL TABLE history_fts USING fts5(prompt, content='history', content_rowid='id');
CREATE TRIGGER history_ai AFTER INSERT ON history BEGIN INSERT INTO history_fts(rowid, prompt) VALUES (new.id, new.prompt); END;
CREATE TABLE session_titles (session_id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE session_recaps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cwd TEXT NOT NULL, recap TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
`);
	db.run("INSERT INTO history (prompt, cwd, session_id) VALUES (?, '/work', ?)", [PROMPT, sessionId]);
	db.run("INSERT INTO history (prompt, cwd, session_id) VALUES ('an earlier prompt with no secret', '/work', 'other')");
	db.run("INSERT INTO session_titles (session_id, title) VALUES (?, ?)", [sessionId, `Store ${GITHUB}`]);
	db.run("INSERT INTO session_recaps (session_id, cwd, recap) VALUES (?, '/work', ?)", [sessionId, `Saved the database URL ${DB_URL}`]);
	db.close();
}

/** A subagent's session file as omp writes it: the fixed-width title slot, the header, then entries. */
function subagentFile(): string {
	const title = JSON.stringify({ type: "title", title: "Helper" });
	return [
		title.padEnd(255, " "),
		JSON.stringify({ type: "session", version: 3, id: "sub-session", timestamp: "2026-11-04T10:00:00.000Z", cwd: "/work" }),
		JSON.stringify({ type: "message", id: "s1", parentId: null, timestamp: "2026-11-04T10:00:01.000Z", message: { role: "user", content: `Check ${DB_URL} answers`, timestamp: 1 } }),
		JSON.stringify({ type: "message", id: "s2", parentId: "s1", timestamp: "2026-11-04T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: `Connected with ${DB_PASSWORD}; the Stripe key ${STRIPE} works.` }], timestamp: 2 } }),
		"",
	].join("\n");
}

/** A real omp session with the prompt, a reply that uses the secrets, a request-log record, a sidecar, and history rows. */
async function session() {
	const root = mkdtempSync(join(tmpdir(), "omp-redact-"));
	roots.push(root);
	const manager = sessionManager.SessionManager.create(root, join(root, "sessions"));
	const user = { role: "user", content: PROMPT, timestamp: 1 };
	manager.appendMessage(user);
	const assistant = {
		role: "assistant",
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-test",
		content: [
			{ type: "thinking", thinking: `I will write ${DB_PASSWORD} to .env`, thinkingSignature: "signature-of-the-thinking" },
			{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: `printf 'DATABASE_URL=${DB_URL}\\nADMIN_PASSWORD=${PASSWORD}\\n' >> .env` } },
		],
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: 2,
	};
	manager.appendMessage(assistant);
	manager.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: `PGPASSWORD=${DB_PASSWORD} ok, key ${STRIPE}` }], isError: false, timestamp: 3 });
	const reply = {
		...assistant,
		content: [
			{ type: "thinking", thinking: "Done, nothing left.", thinkingSignature: "signature-kept" },
			{ type: "text", text: "Saved them to .env." },
		],
		stopReason: "stop",
		timestamp: 4,
	};
	manager.appendMessage(reply);
	const edits = [{ add: { role: "user", content: PROMPT } }];
	const body = { model: "claude-test", messages: [{ role: "user", content: PROMPT }] };
	const blob = (value: unknown) => manager.putBlobSync(Buffer.from(JSON.stringify(value))).ref;
	const oldEdits = blob(edits);
	manager.appendCustomEntry(RECORD_TYPE, {
		requestHash: sha256(canonicalJson(body)),
		provider: "anthropic",
		api: "anthropic-messages",
		model: "claude-test",
		thinkingLevel: "low",
		leafId: null,
		systemPromptHash: null,
		toolsHash: null,
		paramsHash: blob({ model: "claude-test" }),
		messages: { key: "messages", base: null, edits: oldEdits },
	});
	await manager.flush();
	const file = manager.getSessionFile()!;
	const sidecar = file.slice(0, -".jsonl".length);
	mkdirSync(join(sidecar, "Helper"), { recursive: true });
	writeFileSync(join(sidecar, "3.bash.log"), `$ printf 'DATABASE_URL=${DB_URL}' >> .env\nexport STRIPE_SECRET_KEY=${STRIPE}\n`);
	writeFileSync(join(sidecar, "Helper.md"), `The token ${GITHUB} has repo scope.\n`);
	writeFileSync(join(sidecar, "Helper.jsonl"), subagentFile());
	writeFileSync(join(sidecar, "Helper", "0.eval.log"), `connected as admin with ${PASSWORD}\n`);
	seedHistory(manager.getSessionId());
	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | undefined>();
	const warnings: unknown[] = [];
	extension({
		on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<void> | undefined) => handlers.set(name, handler),
		pi: { getAgentDir: () => agentDir, isSessionLeaseHeld: (id: string) => (id === "held-session" ? true : false) },
		logger: { warn: (...args: unknown[]) => warnings.push(args), debug() {} },
	});
	const ctx = { sessionManager: manager };
	const fire = (event: object) => handlers.get(event === SHUTDOWN ? "session_shutdown" : "agent_end")!(event, ctx);
	return { root, manager, file, sidecar, oldEdits, user, assistant, fire, warnings };
}

const SHUTDOWN = { type: "session_shutdown" };

describe("redact-secrets", () => {
	test("a turn that goes on keeps the secrets; the turn's end replaces them everywhere omp keeps the session", async () => {
		const { manager, file, sidecar, oldEdits, user, assistant, fire, warnings } = await session();
		const ids = manager.getEntries().map(entry => [entry.id, entry.parentId]);

		await fire({ type: "agent_end", messages: [], willContinue: true });
		expect(leaked(readFileSync(file))).toEqual(SECRETS);

		await fire({ type: "agent_end", messages: [] });
		expect(warnings).toEqual([]);

		const text = readFileSync(file, "utf8");
		expect(leaked(text)).toEqual([]);
		for (const label of ["stripe live secret key", "stripe live publishable key", "github token", "anthropic api key", "openai api key", "supabase secret key", "aws access key id", "aws secret access key", "google client secret", "database password", "password"]) {
			expect(text).toContain(placeholder(label));
		}

		// The live agent's own message objects still hold the values for the rest of the session.
		expect(user.content).toBe(PROMPT);
		expect(JSON.stringify(assistant)).toContain(DB_PASSWORD);

		// A changed thinking block loses its signature, so a resumed session replays it as text; an unchanged one keeps it.
		const thinking = text.split("\n").filter(line => line.includes('"thinking"'));
		expect(thinking.find(line => line.includes("database password"))).not.toContain("thinkingSignature");
		expect(thinking.find(line => line.includes("Done, nothing left."))).toContain("signature-kept");

		// The file resumes: every line parses, the tree is intact, and the context rebuilds from it.
		const reopened = await sessionManager.SessionManager.open(file);
		const entries = reopened.getEntries();
		expect(entries.map(entry => [entry.id, entry.parentId])).toEqual(ids);
		const byId = new Map(entries.map(entry => [entry.id, entry]));
		const context = sessionContext.buildSessionContext(entries, entries.at(-1)!.id, byId);
		expect(context.messages).toHaveLength(4);
		expect(JSON.stringify(context.messages)).toContain(placeholder("database password"));
		await reopened.close();

		// The request log points at a redacted copy of its messages, and the original blob is gone.
		const blobsDir = join(agentDir, "blobs");
		expect(existsSync(join(blobsDir, oldEdits.slice("blob:sha256:".length)))).toBe(false);
		const [request] = rebuildRequests(text, hash => readFileSync(join(blobsDir, hash), "utf8"));
		expect(request?.redacted).toBe(true);
		expect(leaked(JSON.stringify(request?.body))).toEqual([]);
		expect(JSON.stringify(request?.body)).toContain(placeholder("stripe live secret key"));

		// The sidecar: tool logs, a subagent's output and session file, and the subagent's own folder.
		for (const path of filesUnder(sidecar)) expect({ path, leaked: leaked(readFileSync(path)) }).toEqual({ path, leaked: [] });
		const helper = readFileSync(join(sidecar, "Helper.jsonl"), "utf8");
		expect(helper.slice(0, 256)).toBe(subagentFile().slice(0, 256));
		expect(helper.split("\n").filter(Boolean).map(line => JSON.parse(line).id)).toEqual([undefined, "sub-session", "s1", "s2"]);

		// history.db: the prompt, title, and recap, its search index, and the bytes of the file and its log.
		const db = new Database(historyDb, { readonly: true });
		const prompts = db.query<{ prompt: string }, []>("SELECT prompt FROM history ORDER BY id").all().map(row => row.prompt);
		expect(prompts[0]).toContain(placeholder("password"));
		expect(prompts[1]).toBe("an earlier prompt with no secret");
		expect(db.query("SELECT rowid FROM history_fts WHERE history_fts MATCH ?").all(`"${PASSWORD}"`)).toEqual([]);
		expect(db.query("SELECT rowid FROM history_fts WHERE history_fts MATCH 'earlier'").all()).toHaveLength(1);
		db.close();
		for (const suffix of ["", "-wal", "-shm"]) {
			if (existsSync(historyDb + suffix)) expect({ suffix, leaked: leaked(readFileSync(historyDb + suffix)) }).toEqual({ suffix, leaked: [] });
		}
	});

	test("a later run leaves files it already scrubbed alone, and shutdown catches what a turn left", async () => {
		const { file, sidecar, fire } = await session();
		await fire({ type: "agent_end", messages: [] });
		const scrubbed = statSync(file).mtimeMs;
		await fire({ type: "agent_end", messages: [] });
		expect(statSync(file).mtimeMs).toBe(scrubbed);

		writeFileSync(join(sidecar, "4.bash.log"), `echo ${PASSWORD}\n`);
		await fire(SHUTDOWN);
		expect(readFileSync(join(sidecar, "4.bash.log"), "utf8")).toBe(`echo ${placeholder("password")}\n`);
	});

	test("a subagent session another process still holds waits for a later turn", async () => {
		const { sidecar, fire } = await session();
		const held = subagentFile().replace('"sub-session"', '"held-session"');
		writeFileSync(join(sidecar, "Helper.jsonl"), held);
		await fire({ type: "agent_end", messages: [] });
		expect(readFileSync(join(sidecar, "Helper.jsonl"), "utf8")).toBe(held);
	});
});

describe("Redactor", () => {
	test("leaves references, hashes, and URLs without a password as they are", () => {
		const redactor = new Redactor();
		const text = [
			`password=$DB_PASSWORD and password: "\${ADMIN_PASSWORD}"`,
			`${AWS_ID} at commit 4f8e2a91c0d3b5e7f9a1c3e5d7b9f1a3c5e7d9b1`,
			"postgres://app@localhost:5432/app and postgres://app:<password>@db/app",
			"MAX_TOKENS=4096",
		].join("\n");
		expect(redactor.redact(text, true)).toBe(text.replace(AWS_ID, placeholder("aws access key id")));
	});

	test("is idempotent, and replaces a learned password wherever it shows up later", () => {
		const redactor = new Redactor();
		redactor.learn(`mot de passe : ${PASSWORD}.`, true);
		const once = redactor.redact(PROMPT, true);
		expect(redactor.redact(once, true)).toBe(once);
		expect(redactor.redact(`echo ${PASSWORD}`, false)).toBe(`echo ${placeholder("password")}`);
	});
});

describe("dataDir", () => {
	test("follows omp's XDG data directory for the default and a profile's agent directory, once it exists", () => {
		const xdg = mkdtempSync(join(tmpdir(), "omp-redact-xdg-"));
		roots.push(xdg);
		const home = join(homedir(), ".omp");
		const env = { XDG_DATA_HOME: xdg };
		expect(dataDir(join(home, "agent"), env)).toBe(join(home, "agent"));
		mkdirSync(join(xdg, "omp", "profiles", "work"), { recursive: true });
		expect(dataDir(join(home, "agent"), env)).toBe(join(xdg, "omp"));
		expect(dataDir(join(home, "profiles", "work", "agent"), env)).toBe(join(xdg, "omp", "profiles", "work"));
		expect(dataDir(join(home, "profiles", "play", "agent"), env)).toBe(join(home, "profiles", "play", "agent"));
		expect(dataDir(agentDir, env)).toBe(agentDir);
		expect(dataDir(join(home, "agent"), {})).toBe(join(home, "agent"));
	});
});
