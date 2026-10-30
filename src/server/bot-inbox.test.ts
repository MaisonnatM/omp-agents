import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBot, type Bot, type BotId } from "../shared/bots";
import { BotInbox } from "./bot-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inboxDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-inbox-"));
	dirs.push(dir);
	mkdirSync(join(dir, "bot-inbox"));
	return join(dir, "bot-inbox");
}

const scout: Bot = { id: "scout" as BotId, name: "Scout", job: "", cwd: "/work/webapp", model: null, skill: null, shape: "hexagon", hue: 150, sessionId: "s1", createdAt: "2026-05-01T09:00:00.000Z", pinned: false, section: null };
const relay: Bot = { ...scout, id: "relay" as BotId, name: "Relay", job: "Relay the mail.", sessionId: null };

/** An inbox over Bots that start as `initial`, which each save it applies edits as the dashboard's would, unless `refuse`. */
function harness(dir: string, initial: Bot[], refuse = false) {
	let bots = initial;
	const inbox = new BotInbox(
		dir,
		() => bots,
		change => {
			if (refuse) return false;
			const next = applyBot(bots, change, "2026-05-03T10:00:00.000Z");
			const changed = next !== bots;
			bots = next;
			return changed;
		},
	);
	return { inbox, bots: () => bots };
}

describe("BotInbox", () => {
	test("saves each job to its Bot in order with every other field kept, and sets aside a job for a missing Bot and garbage", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ botId: "scout", job: "Watch the build." }));
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ botId: "scout", job: "Watch the build.\nAsk before merging." }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ botId: "relay", job: "" }));
		writeFileSync(join(dir, "4-x.json"), JSON.stringify({ botId: "gone", job: "Haunt the dashboard." }));
		writeFileSync(join(dir, "5-x.json"), JSON.stringify({ botId: "scout", job: 42 }));
		writeFileSync(join(dir, "6-x.json"), "{not json");
		writeFileSync(join(dir, "7-x.tmp"), JSON.stringify({ botId: "scout", job: "Half written." }));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const { inbox, bots } = harness(dir, [scout, relay]);
		await inbox.drain();
		expect(bots()).toEqual([{ ...scout, job: "Watch the build.\nAsk before merging." }, { ...relay, job: "" }]);
		expect(readdirSync(dir).sort()).toEqual(["4-x.json.invalid", "5-x.json.invalid", "6-x.json.invalid", "7-x.tmp"]);
		expect(logged.mock.calls).toContainEqual([`omp-agents: set aside ${join(dir, "4-x.json")}: there is no Bot gone; it may have been deleted since`]);
		expect(logged.mock.calls).toContainEqual([`omp-agents: set aside ${join(dir, "5-x.json")}: it is not a job for a Bot`]);
		logged.mockRestore();
	});

	test("a job the Bot already holds is done, and a save the Bots refuse moves aside with why", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ botId: "relay", job: "Relay the mail." }));
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ botId: "scout", job: "Watch the build." }));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const { inbox, bots } = harness(dir, [scout, relay], true);
		await inbox.drain();
		expect(bots()).toEqual([scout, relay]);
		expect(readdirSync(dir)).toEqual(["2-x.json.invalid"]);
		expect(logged.mock.calls).toEqual([[`omp-agents: set aside ${join(dir, "2-x.json")}: applying it failed: the Bots refused it`]]);
		logged.mockRestore();
	});
});
