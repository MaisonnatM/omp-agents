import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { MediaTree } from "./media";
import type { AgentMedia } from "./shared";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

const line = (entry: unknown): string => `${JSON.stringify(entry)}\n`;
const call = (id: string, name: string, args: Record<string, unknown>, intent?: string) =>
	line({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args, intent }] } });
const result = (id: string, toolName: string, hash: string, at: string) =>
	line({
		type: "message",
		timestamp: at,
		message: { role: "toolResult", toolCallId: id, toolName, isError: false, content: [{ type: "text", text: "done" }, { type: "image", data: `blob:sha256:${hash}`, mimeType: "image/webp" }] },
	});
const src = (hash: string): string => `/api/image?hash=${hash}&type=image%2Fwebp`;

/** A session file and its artifacts directory, where omp writes its subagents' transcripts. */
function session(): { path: string; artifacts: string } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-media-"));
	dirs.push(dir);
	const artifacts = join(dir, "2026-10-05_s1");
	mkdirSync(join(artifacts, "Smoke"), { recursive: true });
	return { path: `${artifacts}.jsonl`, artifacts };
}

type Emit = { reset: boolean; media: AgentMedia[] };

/** A tree over `path` whose `read` pokes it with a change at `changedPath` and resolves with what that poke emits. */
function treeOf(path: string): { tree: MediaTree; read: (changedPath?: string) => Promise<Emit> } {
	let resolve: ((emit: Emit) => void) | null = null;
	const tree = new MediaTree(path, null, (reset, media) => resolve?.({ reset, media }));
	const read = (changedPath = path): Promise<Emit> => {
		const next = Promise.withResolvers<Emit>();
		resolve = next.resolve;
		tree.poke(changedPath);
		return next.promise;
	};
	return { tree, read };
}

describe("MediaTree", () => {
	test("collects the images the session's and its nested subagents' tools returned, newest first, and leaves out the user's", async () => {
		const { path, artifacts } = session();
		writeFileSync(
			path,
			line({ type: "message", message: { role: "user", content: [{ type: "image", data: `blob:sha256:${HASH_C}`, mimeType: "image/png" }] } }) +
				call("c1", "read", { path: "/tmp/shot.png" }) +
				result("c1", "read", HASH_A, "2026-10-05T10:00:00Z"),
		);
		writeFileSync(join(artifacts, "Smoke.jsonl"), call("c2", "eval", { code: "tab.screenshot()" }, "Screenshotting the sidebar") + result("c2", "eval", HASH_B, "2026-10-05T10:05:00Z"));
		writeFileSync(join(artifacts, "Smoke", "Nested.jsonl"), call("c3", "eval", {}) + result("c3", "eval", HASH_C, "2026-10-05T10:02:00Z"));

		const { reset, media } = await treeOf(path).read();

		expect(reset).toBe(true);
		expect(media).toEqual([
			{ src: src(HASH_B), agentId: "Smoke", tool: "eval", summary: "Screenshotting the sidebar", at: Date.parse("2026-10-05T10:05:00Z") },
			{ src: src(HASH_C), agentId: "Nested", tool: "eval", summary: "", at: Date.parse("2026-10-05T10:02:00Z") },
			{ src: src(HASH_A), agentId: null, tool: "read", summary: "/tmp/shot.png", at: Date.parse("2026-10-05T10:00:00Z") },
		]);
	});

	test("a subagent that starts later arrives with a change under the artifacts directory, an image appended to the file with a change to it, each alone", async () => {
		const { path, artifacts } = session();
		writeFileSync(path, "");
		const { tree, read } = treeOf(path);
		expect(await read()).toEqual({ reset: true, media: [] });

		const later = join(artifacts, "Later.jsonl");
		expect(tree.covers(later)).toBe(true);
		writeFileSync(later, call("c1", "eval", {}, "Shooting") + result("c1", "eval", HASH_A, "2026-10-05T10:00:00Z"));
		const joined = await read(later);
		expect([joined.reset, joined.media.map(item => item.agentId)]).toEqual([false, ["Later"]]);

		appendFileSync(path, call("c2", "read", { path: "/tmp/b.webp" }) + result("c2", "read", HASH_B, "2026-10-05T11:00:00Z"));
		const appended = await read();
		expect([appended.reset, appended.media.map(item => [item.agentId, item.src])]).toEqual([false, [[null, src(HASH_B)]]]);
		expect(tree.media.map(item => item.src)).toEqual([src(HASH_B), src(HASH_A)]);
	});

	test("only its own file, that file's lock sidecar, and its subagents' files are this tree's changes, not a sibling session's", () => {
		const { path, artifacts } = session();
		const dir = dirname(path);
		const tree = new MediaTree(path, null, () => {});
		expect(tree.covers(path)).toBe(true);
		expect(tree.covers(join(dir, `.${basename(path)}.lock`))).toBe(true);
		expect(tree.covers(join(artifacts, "Smoke", "Nested.jsonl"))).toBe(true);
		expect(tree.covers(join(dir, "2026-10-05_s2.jsonl"))).toBe(false);
		expect(tree.covers(join(dir, ".2026-10-05_s2.jsonl.lock"))).toBe(false);
		expect(tree.covers(join(dir, "2026-10-05_s2", "Other.jsonl"))).toBe(false);
	});
});
