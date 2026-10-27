import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { type BotId, parseBotChange } from "../shared/bots";
import { BotsFile } from "./bots-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function botsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-bots-"));
	dirs.push(dir);
	return join(dir, "bots.json");
}

const scout = { id: "scout" as BotId, name: "Scout", job: "Watch the build.", cwd: "~/code/app", model: null, skill: null, shape: "pill", hue: 25 } as const;

test("a saved Bot keeps the conversation the server bound it to through an edit of its job, and a restart reads both", async () => {
	const path = botsPath();
	const file = new BotsFile(path);
	file.apply({ op: "save", bot: scout }, "2026-05-01T09:00:00.000Z");
	file.apply({ op: "bind", id: scout.id, sessionId: "s1" }, "2026-05-01T09:01:00.000Z");
	file.apply({ op: "save", bot: { ...scout, job: "Watch the build. Ask before merging." } }, "2026-05-02T09:00:00.000Z");
	await flushJsonFiles();

	const expected = { ...scout, job: "Watch the build. Ask before merging.", sessionId: "s1", createdAt: "2026-05-01T09:00:00.000Z" };
	expect(new BotsFile(path).value).toEqual([expected]);
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ bots: [expected] });
});

test("a save sent twice, a bind to the same session, and a remove of a gone Bot change nothing", () => {
	const file = new BotsFile(botsPath());
	expect(file.apply({ op: "save", bot: scout }, "2026-05-01T09:00:00.000Z")).toBe(true);
	expect(file.apply({ op: "save", bot: scout }, "2026-05-01T10:00:00.000Z")).toBe(false);
	expect(file.apply({ op: "save", bot: { ...scout, hue: 195 } }, "2026-05-01T10:00:00.000Z")).toBe(true);
	expect(file.apply({ op: "bind", id: scout.id, sessionId: "s1" }, "2026-05-01T10:00:00.000Z")).toBe(true);
	expect(file.apply({ op: "bind", id: scout.id, sessionId: "s1" }, "2026-05-01T10:00:00.000Z")).toBe(false);
	expect(file.apply({ op: "remove", id: "gone" as BotId }, "2026-05-01T10:00:00.000Z")).toBe(false);
	expect(file.apply({ op: "remove", id: scout.id }, "2026-05-01T10:00:00.000Z")).toBe(true);
	expect(file.value).toEqual([]);
});

test("a Bot saved before you could pick its look keeps the shape and color its id gave it", () => {
	const path = botsPath();
	const old = (id: string) => ({ id, name: id, job: "", cwd: "~/code", model: null, skill: null, sessionId: null, createdAt: "2026-05-01T09:00:00.000Z" });
	writeFileSync(path, JSON.stringify({ bots: ["scout", "ranger", "a", "3f2a9c1e-7b4d-4e8a-9f61-0c2d5e8b7a14"].map(old) }));
	expect(new BotsFile(path).value.map(({ shape, hue }) => [shape, hue])).toEqual([["clover", 320], ["diamond", 110], ["triangle", 195], ["square", 195]]);
});

test("a page's change names a Bot by an id that cannot leave its memory directory", () => {
	expect(parseBotChange({ op: "remove", id: "../notes" })).toBeNull();
	expect(parseBotChange({ op: "remove", id: "b-1" })).toEqual({ op: "remove", id: "b-1" as BotId });
	expect(parseBotChange({ op: "save", bot: { ...scout, model: "sonnet" } })).toBeNull();
	expect(parseBotChange({ op: "save", bot: { ...scout, shape: "star" } })).toBeNull();
	expect(parseBotChange({ op: "save", bot: { ...scout, hue: 26 } })).toBeNull();
	expect(parseBotChange({ op: "save", bot: { ...scout, name: " Scout ", model: "anthropic/claude-sonnet-4" } })).toEqual({ op: "save", bot: { ...scout, model: "anthropic/claude-sonnet-4" } });
	expect(parseBotChange({ op: "message", id: "b-1", text: "  " })).toBeNull();
});
