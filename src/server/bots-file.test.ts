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

	const expected = { ...scout, job: "Watch the build. Ask before merging.", sessionId: "s1", createdAt: "2026-05-01T09:00:00.000Z", pinned: false, section: null };
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

test("a Bot saved before it could be pinned or put in a section is neither", () => {
	const path = botsPath();
	writeFileSync(path, JSON.stringify({ bots: [{ ...scout, sessionId: null, createdAt: "2026-05-01T09:00:00.000Z" }] }));
	expect(new BotsFile(path).value.map(({ pinned, section }) => ({ pinned, section }))).toEqual([{ pinned: false, section: null }]);
});

test("pinning and moving a Bot survive a restart and an edit of its job, and a section renames or goes for all its Bots at once", async () => {
	const path = botsPath();
	const file = new BotsFile(path);
	const ranger = { ...scout, id: "ranger" as BotId, name: "Ranger" };
	const janitor = { ...scout, id: "janitor" as BotId, name: "Janitor" };
	for (const bot of [scout, ranger, janitor]) file.apply({ op: "save", bot }, "2026-05-01T09:00:00.000Z");
	file.apply({ op: "pin", id: scout.id, pinned: true }, "2026-05-01T09:01:00.000Z");
	file.apply({ op: "move", id: scout.id, section: "Work" }, "2026-05-01T09:01:00.000Z");
	file.apply({ op: "move", id: ranger.id, section: "Work" }, "2026-05-01T09:01:00.000Z");
	file.apply({ op: "move", id: janitor.id, section: "Chores" }, "2026-05-01T09:01:00.000Z");
	file.apply({ op: "save", bot: { ...scout, job: "Watch the deploy." } }, "2026-05-01T09:02:00.000Z");
	await flushJsonFiles();
	const placed = (bots: readonly { id: string; pinned: boolean; section: string | null }[]) => bots.map(({ id, pinned, section }) => [id, pinned, section]);
	expect(placed(new BotsFile(path).value)).toEqual([["scout", true, "Work"], ["ranger", false, "Work"], ["janitor", false, "Chores"]]);

	expect(file.apply({ op: "rename-section", from: "Work", to: "Day job" }, "2026-05-01T09:03:00.000Z")).toBe(true);
	expect(placed(file.value)).toEqual([["scout", true, "Day job"], ["ranger", false, "Day job"], ["janitor", false, "Chores"]]);
	expect(file.apply({ op: "rename-section", from: "Chores", to: null }, "2026-05-01T09:04:00.000Z")).toBe(true);
	expect(placed(file.value)).toEqual([["scout", true, "Day job"], ["ranger", false, "Day job"], ["janitor", false, null]]);
});

test("a pin, move, or section rename that changes nothing leaves the Bots as they were", () => {
	const file = new BotsFile(botsPath());
	file.apply({ op: "save", bot: scout }, "2026-05-01T09:00:00.000Z");
	file.apply({ op: "move", id: scout.id, section: "Work" }, "2026-05-01T09:00:00.000Z");
	const before = file.value;
	expect(file.apply({ op: "pin", id: scout.id, pinned: false }, "2026-05-01T09:01:00.000Z")).toBe(false);
	expect(file.apply({ op: "move", id: scout.id, section: "Work" }, "2026-05-01T09:01:00.000Z")).toBe(false);
	expect(file.apply({ op: "pin", id: "gone" as BotId, pinned: true }, "2026-05-01T09:01:00.000Z")).toBe(false);
	expect(file.apply({ op: "rename-section", from: "Work", to: "Work" }, "2026-05-01T09:01:00.000Z")).toBe(false);
	expect(file.apply({ op: "rename-section", from: "Nowhere", to: "Work" }, "2026-05-01T09:01:00.000Z")).toBe(false);
	expect(file.value).toBe(before);
});

test("a page's pin, move, and section rename name a section of 1 to 60 characters, trimmed", () => {
	expect(parseBotChange({ op: "pin", id: "b-1", pinned: true })).toEqual({ op: "pin", id: "b-1" as BotId, pinned: true });
	expect(parseBotChange({ op: "pin", id: "b-1", pinned: "yes" })).toBeNull();
	expect(parseBotChange({ op: "move", id: "b-1", section: "  Work  " })).toEqual({ op: "move", id: "b-1" as BotId, section: "Work" });
	expect(parseBotChange({ op: "move", id: "b-1", section: null })).toEqual({ op: "move", id: "b-1" as BotId, section: null });
	expect(parseBotChange({ op: "move", id: "b-1", section: "   " })).toBeNull();
	expect(parseBotChange({ op: "move", id: "b-1", section: "x".repeat(61) })).toBeNull();
	expect(parseBotChange({ op: "move", id: "b-1", section: "x".repeat(60) })).toEqual({ op: "move", id: "b-1" as BotId, section: "x".repeat(60) });
	expect(parseBotChange({ op: "move", id: "b-1" })).toBeNull();
	expect(parseBotChange({ op: "rename-section", from: " Work ", to: "Day job" })).toEqual({ op: "rename-section", from: "Work", to: "Day job" });
	expect(parseBotChange({ op: "rename-section", from: "Work", to: null })).toEqual({ op: "rename-section", from: "Work", to: null });
	expect(parseBotChange({ op: "rename-section", from: "", to: "Day job" })).toBeNull();
	expect(parseBotChange({ op: "rename-section", from: "Work", to: "" })).toBeNull();
});
