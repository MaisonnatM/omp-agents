import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { checkReplayRequest, containsPrompt } from "../../templates/omp/agent/extensions/replay/replay-check";
import { canonicalJson } from "../../templates/omp/agent/extensions/replay/request-log-reader";
import { compareTurns, normalizeRoots } from "./replay";
import type { ReplayMarker } from "./replay";
import { NO_USAGE } from "./trajectory";
import type { Turn, TurnStep } from "./trajectory";

const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const original = { model: "old", instructions: "<project-context>\n<workstation>\n- Model: provider/old\n</workstation>\n<file path=\"/source/AGENTS.md\">Keep dates 2026-01-01 and old names.</file>\n</project-context>", input: [{ role: "user", content: [{ type: "input_text", text: "Read /source/a.ts" }] }], tools: [{ name: "read", description: "Read local files", parameters: { type: "object" } }], reasoning: { effort: "low" }, stream: true, prompt_cache_key: "stable" };
function marker(body: unknown = original): ReplayMarker {
	return { v: 1, id: "replay", source: { sessionId: "source-session", file: "/sessions/source.jsonl", turnId: "u1", at: 1 }, roots: { original: ["/source"], replay: "/replay" }, base: { sha: "a".repeat(40), how: "reflog" }, model: { provider: "provider", id: "old" }, thinking: "low", modelChanged: false, promptEdited: false, repaired: false, originalTurnRef: `blob:sha256:${"b".repeat(64)}`, original: { api: "responses", model: "old", hash: digest(body), bodyRef: `blob:sha256:${"c".repeat(64)}` } };
}
const relocated = () => JSON.parse(JSON.stringify(original).replaceAll("/source", "/replay"));
const check = (body: unknown, origin = marker()) => checkReplayRequest(origin, original, body, "responses", origin.model.id);

describe("replay complete-request claims", () => {
	test("a relocated complete envelope matches while its raw hash differs", () => {
		const result = check(relocated());
		expect(result.status).toBe("match");
		if (result.status === "unknown") throw new Error(result.reason);
		expect(result.rawEqual).toBe(false);
		expect(result.originalHash).toBe(digest(original));
		expect(result.replayHash).toBe(digest(relocated()));
		expect(result.normalizedOriginal).toBe(result.normalizedReplay);
		expect(result.differences).toEqual([]);
	});
	test("only an explicit model switch removes model routing and generated workstation metadata", () => {
		const body = relocated();
		body.model = "new";
		body.instructions = body.instructions.replace("provider/old", "provider/new");
		const origin = { ...marker(), modelChanged: true, model: { provider: "provider", id: "new" } };
		expect(check(body, origin).status).toBe("match");
		expect(check(body).status).toBe("mismatch");
		body.instructions = body.instructions.replace("old names", "new names");
		expect(check(body, origin).status).toBe("mismatch");
	});
	test("dates, docs, tool descriptions, schemas, cache markers, and thinking remain substantive", () => {
		const variants = [
			{ field: "instructions", value: original.instructions.replace("2026-01-01", "2026-01-02") },
			{ field: "instructions", value: `${original.instructions}\nAnother rule` },
			{ field: "tools", value: [{ ...original.tools[0], description: "Different tool" }] },
			{ field: "tools", value: [{ ...original.tools[0], parameters: { type: "string" } }] },
			{ field: "reasoning", value: { effort: "high" } },
			{ field: "prompt_cache_key", value: "different" },
			{ field: "stream", value: false },
			{ field: "input", value: [...original.input, { role: "user", content: [{ type: "input_text", text: "extra context" }] }] },
		];
		for (const { field, value } of variants) {
			const result = check({ ...relocated(), [field]: value });
			expect(result.status).toBe("mismatch");
			if (result.status === "unknown") throw new Error(result.reason);
			expect(result.differences).toEqual([field]);
		}
	});
	test("corrupt source blobs and different APIs are unknown, never a fabricated match", () => {
		expect(checkReplayRequest(marker(), null, original, "responses", "old").status).toBe("unknown");
		expect(checkReplayRequest(marker(), { ...original, stream: false }, original, "responses", "old").status).toBe("unknown");
		const different = checkReplayRequest(marker(), original, original, "messages", "old");
		expect(different.status).toBe("unknown");
		expect(different.rawEqual).toBe(true);
	});
	test("normalization respects path boundaries and never rewrites neighboring repositories", () => {
		expect(normalizeRoots("/source/a /source-other/a x/source/a /source", ["/source"])).toBe("\0<root>/a /source-other/a x/source/a \0<root>");
		expect(normalizeRoots("<root>", ["/source"])).not.toBe(normalizeRoots("/source", ["/source"]));
		expect(normalizeRoots("\0<root>", ["/source"])).not.toBe(normalizeRoots("/source", ["/source"]));
	});
	test("literal normalization markers and structured model options cannot manufacture a match", () => {
		const source = { ...original, input: [{ role: "user", content: "<root>" }] };
		const body = { ...relocated(), input: [{ role: "user", content: "/replay" }] };
		expect(checkReplayRequest(marker(source), source, body, "responses", "old").status).toBe("mismatch");
		const fakeMetadata = relocated();
		fakeMetadata.model = "new";
		fakeMetadata.instructions = fakeMetadata.instructions.replace("provider/old", "<model>");
		expect(check(fakeMetadata, { ...marker(), modelChanged: true, model: { provider: "provider", id: "new" } }).status).toBe("mismatch");
		const structured = { ...original, model: { id: "old", temperature: 0.1 } };
		const changed = { ...relocated(), model: { id: "new", temperature: 0.2 } };
		changed.instructions = changed.instructions.replace("provider/old", "provider/new");
		expect(checkReplayRequest({ ...marker(structured), modelChanged: true }, structured, changed, "responses", "new").status).toBe("mismatch");
	});
	test("main request correlation rejects quoted classifier prompts and preserves images", () => {
		const user = [{ type: "text", text: "do this" }, { type: "image", data: "cGljdHVyZQ==", mimeType: "image/png" }];
		expect(containsPrompt({ input: [{ role: "user", content: [{ type: "input_text", text: "Classify: do this" }] }] }, user)).toBe(false);
		expect(containsPrompt({ input: [{ role: "user", content: [{ type: "input_text", text: "do this" }, { type: "input_image", image_url: "data:image/png;base64,cGljdHVyZQ==" }] }] }, user)).toBe(true);
		expect(containsPrompt({ messages: [{ role: "user", content: "do this" }] }, user)).toBe(false);
		expect(containsPrompt({ messages: [{ role: "user", content: [{ type: "text", text: "[Image #1]" }, { type: "image", data: "cGljdHVyZQ==" }] }] }, user.slice(1))).toBe(true);
	});
});

function tool(name: string, args = "{}", cut = 0): TurnStep {
	return { kind: "tool", name, callId: name, args: { text: args, cut }, status: "ok", resultBytes: 0, resultImages: 0, durationMs: 1 };
}
function turn(steps: TurnStep[], usage = NO_USAGE): Turn { return { id: "u1", index: 1, at: 1, steps, usage, requests: 1, toolCalls: steps.filter(step => step.kind === "tool").length }; }
describe("replay outcome comparison", () => {
	test("ordered tools retain repeated calls, insertions, deletions, and argument changes", () => {
		const result = compareTurns(turn([tool("read", "/source/a"), tool("read", "second"), tool("write")]), turn([tool("read", "/replay/a"), tool("edit"), tool("read", "changed")]), marker().roots);
		expect(result.tools.map(pair => [pair.original?.name ?? null, pair.replay?.name ?? null, pair.same])).toEqual([["read", "read", true], [null, "edit", false], ["read", "read", false], ["write", null, false]]);
	});
	test("clipped argument previews cannot establish equality", () => {
		expect(compareTurns(turn([tool("read", "same", 5)]), turn([tool("read", "same", 5)]), marker().roots).tools[0]?.same).toBe(false);
	});
	test("final text means the last model request, with complete token and cost totals", () => {
		const request: TurnStep = { kind: "request", model: "old", usage: NO_USAGE, stopReason: "stop", durationMs: 1 };
		const a = turn([{ kind: "reply", body: { text: "intermediate", cut: 0 } }, request, { kind: "reply", body: { text: "/source/done", cut: 0 } }], { input: 10, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.01 });
		const b = turn([request, { kind: "reply", body: { text: "/replay/done", cut: 0 } }], { input: 20, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.02 });
		const result = compareTurns(a, b, marker().roots);
		expect(result.reply).toEqual({ original: { text: "/source/done", cut: 0 }, replay: { text: "/replay/done", cut: 0 }, same: true });
		expect(result.tokens).toEqual({ original: 19, replay: 23 });
		expect(result.cost).toEqual({ original: 0.01, replay: 0.02 });
	});
});
