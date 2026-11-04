import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { botMessageText } from "../shared/bot-message";
import { applyBot, type Bot, BOT_MESSAGE_WINDOW_MS, type BotId, defaultLook, MAX_BOT_MESSAGES_PER_HOUR } from "../shared/bots";
import { BotInbox, PairLimit } from "./bot-inbox";

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

const scout: Bot = { id: "scout" as BotId, kind: "routines", name: "Scout", job: "", cwd: "/work/webapp", model: null, skill: null, shape: "hexagon", hue: 150, sessionId: "s1", createdAt: "2026-05-01T09:00:00.000Z", pinned: false, section: null };
const relay: Bot = { ...scout, id: "relay" as BotId, name: "Relay", job: "Relay the mail.", sessionId: null };
const eggbot: Bot = { ...scout, id: "eggbot" as BotId, kind: "bot-designer", name: "Dr Eggbot", job: "Design my Bots.", cwd: "/work/lab" };
const newBot = { id: "8c1d6f0e-2b7a-4c39-9e58-41f7a3b2d6c0" as BotId, kind: "routines", name: "Watcher", job: "Watch the build.", cwd: "/work/lab" } as const;

/**
 * An inbox over Bots that start as `initial`, which each save it applies edits as the dashboard's would, unless
 * `refuse`; `sent` holds each message it sent a Bot.
 */
function harness(dir: string, initial: Bot[], refuse = false) {
	let bots = initial;
	const sent: [BotId, string][] = [];
	const inbox = new BotInbox(dir, {
		bots: () => bots,
		save: change => {
			if (refuse) return false;
			const next = applyBot(bots, change, "2026-05-03T10:00:00.000Z");
			const changed = next !== bots;
			bots = next;
			return changed;
		},
		tell: async (to, text) => sent.push([to, text]),
		now: () => 0,
	});
	return { inbox, bots: () => bots, sent };
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
		expect(logged.mock.calls).toContainEqual([`omp-agents: set aside ${join(dir, "5-x.json")}: it is not a request for the Bots`]);
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

	test("a designer's create saves a new Bot, and a misrouted create from a Bot that is no designer, or a new Bot the page would refuse, is set aside", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ botId: "eggbot", create: newBot }));
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ botId: "eggbot", create: { id: "herd", kind: "pr-shepherd", name: " Shepherd ", job: "Merge it.", cwd: "/work/webapp", model: "x/y", shape: "pill" } }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ botId: "scout", create: { ...newBot, id: "sneaky" } }));
		writeFileSync(join(dir, "4-x.json"), JSON.stringify({ botId: "eggbot", create: { ...newBot, id: "blank", name: " " } }));
		writeFileSync(join(dir, "5-x.json"), JSON.stringify({ botId: "eggbot", create: { ...newBot, id: "nowhere", cwd: undefined } }));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const { inbox, bots } = harness(dir, [scout, eggbot]);
		await inbox.drain();
		const created = { model: null, skill: null, sessionId: null, createdAt: "2026-05-03T10:00:00.000Z", pinned: false, section: null };
		const herd = "herd" as BotId;
		expect(bots()).toEqual([
			scout,
			eggbot,
			{ ...newBot, ...defaultLook(newBot.id), ...created },
			{ id: herd, kind: "pr-shepherd", name: "Shepherd", job: "Merge it.", cwd: "/work/webapp", ...defaultLook(herd), ...created },
		]);
		expect(readdirSync(dir).sort()).toEqual(["3-x.json.invalid", "4-x.json.invalid", "5-x.json.invalid"]);
		expect(logged.mock.calls).toContainEqual([`omp-agents: set aside ${join(dir, "3-x.json")}: Bot scout is not a Bot designer, so the create was misrouted`]);
		expect(logged.mock.calls).toContainEqual([`omp-agents: set aside ${join(dir, "5-x.json")}: it is not a request for the Bots`]);
		logged.mockRestore();
	});

	test("a create read again after its Bot exists changes nothing and is done, even after the Bot was edited", async () => {
		const dir = inboxDir();
		const watcher: Bot = { ...scout, ...newBot, name: "Watcher, renamed" };
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ botId: "eggbot", create: newBot }));
		const { inbox, bots } = harness(dir, [eggbot, watcher], true);
		await inbox.drain();
		expect(bots()).toEqual([eggbot, watcher]);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("a message reaches the other Bot stamped with its sender, and one to itself or to a Bot that is gone is set aside", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ botId: "scout", message: { to: "relay", text: "Relay the build report." } }));
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ botId: "scout", message: { to: "scout", text: "Hello me." } }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ botId: "scout", message: { to: "gone", text: "Hello?" } }));
		writeFileSync(join(dir, "4-x.json"), JSON.stringify({ botId: "scout", message: { to: "relay", text: "!rm -rf ~" } }));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const { inbox, sent } = harness(dir, [scout, relay]);
		await inbox.drain();
		expect(sent).toEqual([[relay.id, botMessageText({ from: scout.id, name: "Scout", text: "Relay the build report." })]]);
		expect(readdirSync(dir).sort()).toEqual(["2-x.json.invalid", "3-x.json.invalid", "4-x.json.invalid"]);
		expect(logged.mock.calls).toContainEqual([`omp-agents: set aside ${join(dir, "2-x.json")}: it is not a request for the Bots`]);
		expect(logged.mock.calls).toContainEqual([`omp-agents: set aside ${join(dir, "4-x.json")}: it is not a request for the Bots`]);
		logged.mockRestore();
	});

	test("a message past the hourly limit is not delivered, and its sender is told once", async () => {
		const dir = inboxDir();
		for (let i = 0; i < MAX_BOT_MESSAGES_PER_HOUR + 2; i++) writeFileSync(join(dir, `${String(i).padStart(2, "0")}-x.json`), JSON.stringify({ botId: "scout", message: { to: "relay", text: `Ping ${i}.` } }));
		const { inbox, sent } = harness(dir, [scout, relay]);
		await inbox.drain();
		expect(sent.length).toBe(MAX_BOT_MESSAGES_PER_HOUR + 1);
		expect(sent.at(-1)).toEqual([
			scout.id,
			`The dashboard did not deliver your message to Relay: you sent it ${MAX_BOT_MESSAGES_PER_HOUR} messages in the last hour; the dashboard drops the next ones without telling you until the hour has passed.`,
		]);
		expect(readdirSync(dir)).toEqual([]);
	});
});

describe("PairLimit", () => {
	test("past the limit from one Bot to another, the sender is told once and the rest drop, other Bots still hear from it, and an hour later it delivers again", () => {
		const limit = new PairLimit();
		for (let at = 0; at < MAX_BOT_MESSAGES_PER_HOUR; at++) {
			expect(limit.check(scout.id, relay.id, at)).toBe("deliver");
			limit.delivered(scout.id, relay.id, at);
		}
		expect(limit.check(scout.id, relay.id, MAX_BOT_MESSAGES_PER_HOUR)).toBe("tell");
		expect(limit.check(scout.id, relay.id, MAX_BOT_MESSAGES_PER_HOUR)).toBe("drop");
		expect(limit.check(scout.id, eggbot.id, MAX_BOT_MESSAGES_PER_HOUR)).toBe("deliver");
		expect(limit.check(scout.id, relay.id, BOT_MESSAGE_WINDOW_MS - 1)).toBe("drop");
		expect(limit.check(scout.id, relay.id, BOT_MESSAGE_WINDOW_MS)).toBe("deliver");
	});
});
