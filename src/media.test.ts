import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { MediaTree } from "./media";
import type { AgentMedia, AgentSource } from "./shared/transcript";

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
const textResult = (id: string, toolName: string, text: string, at: string) =>
	line({ type: "message", timestamp: at, message: { role: "toolResult", toolCallId: id, toolName, isError: false, content: [{ type: "text", text }] } });
/** The session file's header: the session started a minute ago in `cwd`. */
const header = (cwd: string) => line({ type: "session", version: 3, id: "s1", timestamp: new Date(Date.now() - 60_000).toISOString(), cwd });
const fileSrc = (path: string): string => `/api/media?path=${encodeURIComponent(path)}`;

/** A session file and its artifacts directory, where omp writes its subagents' transcripts. */
function session(): { path: string; artifacts: string } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-media-"));
	dirs.push(dir);
	const artifacts = join(dir, "2026-10-05_s1");
	mkdirSync(join(artifacts, "Smoke"), { recursive: true });
	return { path: `${artifacts}.jsonl`, artifacts };
}

type Emit = { reset: boolean; media: AgentMedia[]; sources: AgentSource[] };

/** A tree over `path` whose `read` pokes it with a change at `changedPath` and resolves with what that poke emits. */
function treeOf(path: string): { tree: MediaTree; read: (changedPath?: string) => Promise<Emit> } {
	let resolve: ((emit: Emit) => void) | null = null;
	const tree = new MediaTree(path, null, (reset, media, sources) => resolve?.({ reset, media, sources }));
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
			{ src: src(HASH_B), path: null, agentId: "Smoke", tool: "eval", summary: "Screenshotting the sidebar", at: Date.parse("2026-10-05T10:05:00Z") },
			{ src: src(HASH_C), path: null, agentId: "Nested", tool: "eval", summary: "", at: Date.parse("2026-10-05T10:02:00Z") },
			{ src: src(HASH_A), path: "/tmp/shot.png", agentId: null, tool: "read", summary: "/tmp/shot.png", at: Date.parse("2026-10-05T10:00:00Z") },
		]);
	});

	test("a subagent that starts later arrives with a change under the artifacts directory, an image appended to the file with a change to it, each alone", async () => {
		const { path, artifacts } = session();
		writeFileSync(path, "");
		const { tree, read } = treeOf(path);
		expect(await read()).toEqual({ reset: true, media: [], sources: [] });

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

	test("a file rewritten shorter resets the list to the images it holds now, and a later append adds to that", async () => {
		const { path } = session();
		writeFileSync(path, call("c1", "eval", {}) + result("c1", "eval", HASH_A, "2026-10-05T10:00:00Z") + call("c2", "eval", {}) + result("c2", "eval", HASH_B, "2026-10-05T10:01:00Z"));
		const { tree, read } = treeOf(path);
		expect((await read()).media.map(item => item.src)).toEqual([src(HASH_B), src(HASH_A)]);

		writeFileSync(path, call("c3", "eval", {}) + result("c3", "eval", HASH_C, "2026-10-05T10:02:00Z"));
		const rewritten = await read();
		expect([rewritten.reset, rewritten.media.map(item => item.src)]).toEqual([true, [src(HASH_C)]]);

		appendFileSync(path, call("c4", "eval", {}) + result("c4", "eval", HASH_A, "2026-10-05T10:03:00Z"));
		const appended = await read();
		expect([appended.reset, appended.media.map(item => item.src)]).toEqual([false, [src(HASH_A)]]);
		expect(tree.media.map(item => item.src)).toEqual([src(HASH_A), src(HASH_C)]);
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

	test("lists an image file the session wrote that a tool result names, once, at its path through /api/media", async () => {
		const { path } = session();
		const dir = dirname(path);
		const shot = join(dir, "x.png");
		writeFileSync(shot, "png");
		writeFileSync(path, header(dir) + call("c1", "bash", { command: "bun run shoot" }, "Shooting the page") + textResult("c1", "bash", `Saved ${shot}\nOpen ${shot}.`, "2026-10-05T10:00:00Z"));

		const { media } = await treeOf(path).read();

		expect(media).toEqual([{ src: fileSrc(shot), path: shot, agentId: null, tool: "bash", summary: "Shooting the page", at: Date.parse("2026-10-05T10:00:00Z") }]);
	});

	test("resolves a relative path in a call's arguments against the call's own cwd, itself against the session's", async () => {
		const { path } = session();
		const dir = dirname(path);
		mkdirSync(join(dir, "app", "shots"), { recursive: true });
		writeFileSync(join(dir, "app", "shots", "y.png"), "png");
		writeFileSync(path, header(dir) + call("c1", "bash", { command: "bun run shoot --out shots/y.png", cwd: "app" }) + textResult("c1", "bash", "done", "2026-10-05T10:00:00Z"));

		const { media } = await treeOf(path).read();

		expect(media.map(item => item.path)).toEqual([join(dir, "app", "shots", "y.png")]);
	});

	test("leaves out a named file modified before the session started and a named file that does not exist", async () => {
		const { path } = session();
		const dir = dirname(path);
		writeFileSync(join(dir, "fresh.png"), "png");
		writeFileSync(join(dir, "old.png"), "png");
		utimesSync(join(dir, "old.png"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
		writeFileSync(path, header(dir) + call("c1", "bash", { command: "ls" }) + textResult("c1", "bash", "old.png\nfresh.png\ngone.png", "2026-10-05T10:00:00Z"));

		const { media } = await treeOf(path).read();

		expect(media.map(item => item.path)).toEqual([join(dir, "fresh.png")]);
	});

	test("a later read of a listed file adds no second entry, while another tool's image still arrives", async () => {
		const { path } = session();
		const dir = dirname(path);
		const shot = join(dir, "x.png");
		writeFileSync(shot, "png");
		writeFileSync(path, header(dir) + call("c1", "bash", { command: "bun run shoot" }) + textResult("c1", "bash", `Saved ${shot}`, "2026-10-05T10:00:00Z"));
		const { tree, read } = treeOf(path);
		expect((await read()).media.map(item => item.src)).toEqual([fileSrc(shot)]);

		appendFileSync(path, call("c2", "read", { path: shot }) + result("c2", "read", HASH_A, "2026-10-05T10:01:00Z") + call("c3", "eval", {}) + result("c3", "eval", HASH_B, "2026-10-05T10:02:00Z"));
		const appended = await read();

		expect([appended.reset, appended.media.map(item => item.src)]).toEqual([false, [src(HASH_B)]]);
		expect(tree.media.map(item => item.src)).toEqual([src(HASH_B), fileSrc(shot)]);
	});

	test("collects the pages the session's and its subagents' tools opened, each URL once and oldest first, leaving out failed calls and this computer", async () => {
		const { path, artifacts } = session();
		const errorResult = line({ type: "message", timestamp: "2026-10-05T10:03:00Z", message: { role: "toolResult", toolCallId: "c4", toolName: "read", isError: true, content: [{ type: "text", text: "404" }] } });
		writeFileSync(
			path,
			call("c1", "read", { path: "https://docs.example.com/guide?x=1" }) +
				textResult("c1", "read", "guide", "2026-10-05T10:01:00Z") +
				call("c2", "read", { path: "pr://acme/app/42/diff" }) +
				textResult("c2", "read", "diff", "2026-10-05T10:02:00Z") +
				call("c3", "eval", { code: 'await browser.open({ url: "http://localhost:3000/" }); await browser.open("https://docs.example.com/guide?x=1")' }) +
				textResult("c3", "eval", "ok", "2026-10-05T10:04:00Z") +
				call("c4", "read", { path: "https://gone.example.com/" }) +
				errorResult +
				call("c5", "read", { path: "pr://42" }) +
				textResult("c5", "read", "pr", "2026-10-05T10:05:00Z"),
		);
		writeFileSync(join(artifacts, "Smoke.jsonl"), call("c6", "web_fetch", { url: "https://news.example.org/a" }) + textResult("c6", "web_fetch", "a", "2026-10-05T10:00:00Z"));

		const { sources } = await treeOf(path).read();

		expect(sources.map(({ url, agentId }) => [url, agentId])).toEqual([
			["https://news.example.org/a", "Smoke"],
			["https://docs.example.com/guide?x=1", null],
			["https://github.com/acme/app/pull/42", null],
		]);
	});
});
