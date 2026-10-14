import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDir } from "../../src/omp/install";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const harness = `
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const [packageDir, extensionPath, root] = process.argv.slice(2);
// The installed omp package and extension paths are runtime-selected argv inputs.
const { SessionManager } = await import(join(packageDir, "src/session/session-manager.ts"));
const { canonicalJson } = await import(join(extensionPath, "../replay/request-log-reader.ts"));
const { default: extension } = await import(extensionPath);
const sourceRoot = join(root, "source"), replayRoot = join(root, "replay");
mkdirSync(sourceRoot); mkdirSync(replayRoot);
const manager = SessionManager.create(replayRoot, join(root, "sessions"));
const original = { model: "test-model", instructions: "Work in " + sourceRoot, input: [{ role: "user", content: [{ type: "input_text", text: "selected" }] }], tools: [{ type: "function", name: "bash", description: "Run shell" }], reasoning: { effort: "low" }, stream: true };
const bodyRef = manager.putBlobSync(Buffer.from(canonicalJson(original))).ref;
const originalTurnRef = manager.putBlobSync(Buffer.from(JSON.stringify({ id: "source-user", steps: [] }))).ref;
await manager.newSession();
const marker = { v: 1, id: "replay-id", source: { file: join(root, "source.jsonl"), sessionId: "source", turnId: "source-user", at: 1 }, roots: { original: [sourceRoot], replay: replayRoot }, base: { sha: "a".repeat(40), how: "reflog" }, model: { provider: "test", id: "test-model" }, thinking: "low", modelChanged: false, promptEdited: false, repaired: false, originalTurnRef, original: { api: "responses", model: "test-model", hash: createHash("sha256").update(canonicalJson(original)).digest("hex"), bodyRef } };
manager.appendCustomEntry("omp-agents-replay", marker);
const handlers = new Map();
const flags = { "replay-safe-edits": true, "replay-package": packageDir, "replay-nonce": "fresh-launch" };
extension({ registerFlag() {}, getFlag(name) { return flags[name]; }, on(name, fn) { handlers.set(name, fn); }, appendEntry(type, data) { manager.appendCustomEntry(type, data); } });
const ctx = { cwd: replayRoot, model: { provider: "test", id: "test-model", api: "responses" }, sessionManager: manager };
await handlers.get("session_switch")({}, ctx);
manager.appendMessage({ role: "user", content: "selected", timestamp: Date.now() });
await handlers.get("before_provider_request")({ payload: { model: "test-model", input: [{ role: "user", content: [{ type: "input_text", text: "Classify this prompt: selected" }] }] } }, ctx);
const checks = () => manager.getEntries().filter(entry => entry.customType === "omp-agents-replay-check");
const beforeMain = checks().length;
const payload = JSON.parse(JSON.stringify(original).replaceAll(sourceRoot, replayRoot));
const unchanged = JSON.stringify(payload);
await handlers.get("before_provider_request")({ payload }, ctx);
const check = checks()[0]?.data;
await handlers.get("before_provider_request")({ payload: { ...payload, stream: false } }, ctx);
const blocked = await handlers.get("tool_call")({ toolName: "bash", toolCallId: "external", input: { command: "touch /outside" } }, ctx);
const local = await handlers.get("tool_call")({ toolName: "write", toolCallId: "local", input: { path: "inside.txt", content: "allowed" } }, ctx);
await manager.flush();
const ready = manager.getEntries().find(entry => entry.customType === "omp-agents-replay-ready")?.data;
console.log(JSON.stringify({ beforeMain, count: checks().length, status: check?.status, rawEqual: check?.rawEqual, differences: check?.differences, unchanged: unchanged === JSON.stringify(payload), retainedTools: payload.tools, blocked: blocked?.block === true, local: local ?? null, ready }));
await manager.close();
`;

test("the real guard records a full normalized check before send, skips classifier calls, blocks execution, and acknowledges a fresh native launch", () => {
	const root = mkdtempSync(join(tmpdir(), "omp-replay-hooks-")); roots.push(root);
	const extensionPath = join(import.meta.dir, "agent/extensions/replay-guard.ts");
	const child = Bun.spawnSync([process.execPath, "run", "-", packageDir, extensionPath, root], { stdin: Buffer.from(harness), stdout: "pipe", stderr: "pipe" });
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	const result: unknown = JSON.parse(child.stdout.toString());
	expect(result).toEqual({ beforeMain: 0, count: 1, status: "match", rawEqual: false, differences: [], unchanged: true, retainedTools: [{ type: "function", name: "bash", description: "Run shell" }], blocked: true, local: null, ready: { v: 1, id: "replay-id", nonce: "fresh-launch" } });
});
