import { describe, expect, test } from "bun:test";
import type { Routine } from "../src/routines";
import { DESIGNER_JOB, DESIGNER_NAME } from "../src/shared/bot-designer";
import { type Bot, type BotId, type BotLast, jobLine } from "../src/shared/bots";
import { SHEPHERD_JOB, SHEPHERD_NAME } from "../src/shared/shepherd";
import type { RosterHost } from "../src/shared/sessions";
import { botGroupKey, botGroupLabel, botGroupListName, botGroups, botHost, botMovesTo, type BotRow, botRows, botSections, botsGrouped, botsNeedingYou, botStatus, botView, JOB_TEMPLATES, memoryEntries, NEW_BOT_DRAFT, openBot, pickKind, pickTemplate, starterPrompts } from "./bots-model";
import type { BotRoutineRoute, Page } from "./routing";

const scout = "scout" as BotId;

const bot = (sessionId: string | null): Bot => ({ id: scout, kind: "routines", name: "Scout", job: "", cwd: "~/code/webapp", model: null, skill: null, shape: "clover", hue: 320, sessionId, createdAt: "2026-10-05T09:00:00.000Z", pinned: false, section: null });

describe("Bots", () => {
	test("the Bot's running session is the host of its session id, and none without one", () => {
		const hosts = [{ instanceId: "7c51f77b", sessionId: "s1" }] as RosterHost[];
		expect(botHost(bot("s1"), hosts)?.instanceId).toBe("7c51f77b");
		expect(botHost(bot("s2"), hosts)).toBeNull();
		expect(botHost(bot(null), hosts)).toBeNull();
	});

	test("the Bot's conversation is its running session, else its saved one, and none before its first message", () => {
		const hosts = [{ instanceId: "7c51f77b", sessionId: "s1" }] as RosterHost[];
		expect(botView(bot("s1"), hosts)).toEqual({ kind: "live", instanceId: "7c51f77b", agentId: null });
		expect(botView(bot("s2"), hosts)).toEqual({ kind: "past", sessionId: "s2" });
		expect(botView(bot(null), hosts)).toBeNull();
	});

	test("the open Bot's page shows its conversation, streamed, only while no routine replaces it, and a routine it does not have shows as missing", () => {
		const bots = [bot("s2")];
		const routines = [{ id: "r1", botId: scout }, { id: "r2", botId: "ranger" }] as Routine[];
		const page = (routine: BotRoutineRoute | null): Page => ({ kind: "bots", target: "scout", routine });
		const shown = (routine: BotRoutineRoute | null) => {
			const open = openBot(page(routine), bots, [], routines);
			return open && { view: open.view, routine: open.routine, routines: open.routines.map(({ id }) => id) };
		};
		expect(shown(null)).toEqual({ view: { kind: "past", sessionId: "s2" }, routine: { kind: "conversation" }, routines: ["r1"] });
		expect(shown({ kind: "list" })).toMatchObject({ view: null, routine: { kind: "list" } });
		expect(shown({ kind: "new" })).toMatchObject({ view: null, routine: { kind: "new" } });
		expect(shown({ kind: "open", id: "r1" })).toMatchObject({ view: null, routine: { kind: "open", routine: { id: "r1" } } });
		expect(shown({ kind: "edit", id: "r1" })).toMatchObject({ view: null, routine: { kind: "edit", routine: { id: "r1" } } });
		expect(shown({ kind: "open", id: "r2" })).toMatchObject({ view: null, routine: { kind: "missing", id: "r2" } });
		expect(shown({ kind: "edit", id: "gone" })).toMatchObject({ view: null, routine: { kind: "missing", id: "gone" } });
	});

	test("no Bot is open on another page, on the New Bot form, while the Bots load, or for a Bot that is gone", () => {
		const bots = [bot("s2")];
		expect(openBot({ kind: "bots", target: "ranger", routine: null }, bots, [], [])).toBeNull();
		expect(openBot({ kind: "bots", target: null, adding: false }, bots, [], [])).toBeNull();
		expect(openBot({ kind: "bots", target: "scout", routine: null }, null, [], [])).toBeNull();
		expect(openBot({ kind: "calendar" }, bots, [], [])).toBeNull();
		expect(openBot(null, bots, [], [])).toBeNull();
	});

	test("a row previews the question first, then Working…, then the freshest words as plain text, else no messages", () => {
		const named = (id: string, name: string, sessionId: string | null): Bot => ({ ...bot(sessionId), id: id as BotId, name });
		const bots = [named("asker", "Asker", "s1"), named("worker", "Worker", "s2"), named("replied", "Replied", "s3"), named("talked", "Talked", "s4"), named("scheduled", "Scheduled", "s5"), named("handed", "Handed", "s6"), named("fresh", "Fresh", null)];
		const hosts = [
			{ sessionId: "s1", status: "needs-input", requests: [{ title: "Push to main?" }], unread: null },
			{ sessionId: "s2", status: "working", requests: [], unread: null },
			{ sessionId: "s3", status: "idle", requests: [], unread: { at: 5_000, reply: "**Résumé:** The build is `green`." } },
		] as unknown as RosterHost[];
		const lasts: Record<BotId, BotLast | null> = {
			["asker" as BotId]: { at: 4_000, from: "bot", text: "Shall I push?" },
			["worker" as BotId]: { at: 3_000, from: "user", text: "Check the deploy." },
			["replied" as BotId]: { at: 2_000, from: "user", text: "How is the build?" },
			["talked" as BotId]: { at: 1_000, from: "user", text: "Thanks." },
			["scheduled" as BotId]: { at: 500, from: "routine", name: "Nightly build", text: "Check the **inbox**." },
			["handed" as BotId]: { at: 400, from: "peer", name: "Triage", text: "Fix the `flaky` test." },
		};
		expect(botRows(bots, hosts, lasts).map(({ bot, host, unread, preview, at }) => [bot.name, host?.sessionId ?? null, unread, preview, at])).toEqual([
			["Fresh", null, false, "No messages yet", Date.parse("2026-10-05T09:00:00.000Z")],
			["Replied", "s3", true, "The build is green.", 5_000],
			["Asker", "s1", false, "Push to main?", 4_000],
			["Worker", "s2", false, "Working…", 3_000],
			["Talked", null, false, "You: Thanks.", 1_000],
			["Scheduled", null, false, "Nightly build: Check the inbox.", 500],
			["Handed", null, false, "Triage: Fix the flaky test.", 400],
		]);
	});

	test("the Bots that need you are those asking you and those with a turn you have not read, never one at rest or without a running session", () => {
		const named = (id: string, sessionId: string | null): Bot => ({ ...bot(sessionId), id: id as BotId, name: id });
		const bots = [named("asker", "s1"), named("replied", "s2"), named("read", "s3"), named("stopped", "s4"), named("fresh", null)];
		const hosts = [
			{ sessionId: "s1", status: "needs-input", requests: [{ title: "Push to main?" }], unread: null },
			{ sessionId: "s2", status: "idle", requests: [], unread: { at: 5_000, reply: "Done." } },
			{ sessionId: "s3", status: "idle", requests: [], unread: null },
		] as unknown as RosterHost[];
		expect(botsNeedingYou(botRows(bots, hosts, {}))).toBe(2);
	});

	test("a Bot's status asks first, then names its session's status, else whether it ever talked", () => {
		const hosts = [
			{ sessionId: "s1", status: "needs-input", requests: [{ title: "Push to main?" }], unread: null },
			{ sessionId: "s2", status: "working", requests: [], unread: null },
		] as unknown as RosterHost[];
		expect(botStatus(bot("s1"), hosts[0]!)).toBe("asking you");
		expect(botStatus(bot("s2"), hosts[1]!)).toBe("working");
		expect(botStatus(bot("s4"), null)).toBe("not running");
		expect(botStatus(bot(null), null)).toBe("no conversation yet");
	});

	test("a job's first line is its first sentence, past headings and list marks", () => {
		expect(jobLine("## Role\n\n- Watch the main branch's CI and tell me what broke. Ask before you push.")).toBe("Watch the main branch's CI and tell me what broke.");
		expect(jobLine("Triage the v1.2 issues")).toBe("Triage the v1.2 issues");
		expect(jobLine("  \n# Only a heading")).toBe("");
	});

	test("a new Bot offers its job's first sentence, then what it needs, then a fact to remember", () => {
		expect(starterPrompts("Watch the build. Ask first.")).toEqual(["Watch the build.", "What do you need from me to do this job well?", "Remember that I prefer short answers."]);
		expect(starterPrompts("")).toEqual(["What should your job be? Ask me a few questions.", "What can you help me with?", "Remember that I prefer short answers."]);
	});

	test("the New Bot form starts on a Bot designer, and picking a type swaps the name and job the last type filled but keeps what you typed", () => {
		expect(NEW_BOT_DRAFT).toEqual({ kind: "bot-designer", name: DESIGNER_NAME, job: DESIGNER_JOB });
		const shepherd = pickKind(NEW_BOT_DRAFT, "pr-shepherd");
		expect(shepherd).toEqual({ kind: "pr-shepherd", name: SHEPHERD_NAME, job: SHEPHERD_JOB });
		expect(pickKind(shepherd, "routines")).toEqual({ kind: "routines", name: "", job: "" });
		expect(pickKind({ kind: "routines", name: "Scout", job: "Watch the build." }, "bot-designer")).toEqual({ kind: "bot-designer", name: "Scout", job: "Watch the build." });
		expect(pickKind({ ...NEW_BOT_DRAFT, name: "Egg" }, "pr-shepherd")).toEqual({ kind: "pr-shepherd", name: "Egg", job: SHEPHERD_JOB });
		const [template] = JOB_TEMPLATES;
		expect(pickKind({ kind: "routines", name: template!.name, job: template!.job }, "pr-shepherd")).toEqual(shepherd);
		const edited = { ...shepherd, job: `${SHEPHERD_JOB}\nNever rebase.` };
		expect(pickKind(edited, "pr-shepherd")).toBe(edited);
	});

	test("a template fills the name and job the form filled, from a blank form or another template, and keeps what you typed", () => {
		const [reviewer, retro] = JOB_TEMPLATES;
		const blank = { kind: "routines", name: "", job: "" } as const;
		const fromReviewer = pickTemplate(blank, reviewer!);
		expect(fromReviewer).toEqual({ kind: "routines", name: reviewer!.name, job: reviewer!.job });
		expect(pickTemplate(fromReviewer, retro!)).toEqual({ kind: "routines", name: retro!.name, job: retro!.job });
		expect(pickTemplate({ ...blank, name: "Scout" }, retro!)).toEqual({ kind: "routines", name: "Scout", job: retro!.job });
		expect(pickTemplate({ ...fromReviewer, job: "Review only my docs." }, retro!)).toEqual({ kind: "routines", name: retro!.name, job: "Review only my docs." });
	});

	test("a memory reads as one fact per line, with the day remember wrote when the line has one", () => {
		expect(memoryEntries("- 2026-10-05 Prefers short answers.\n\n- Uses pnpm\nplain line\n")).toEqual([
			{ date: "2026-10-05", fact: "Prefers short answers." },
			{ date: null, fact: "Uses pnpm" },
			{ date: null, fact: "plain line" },
		]);
		expect(memoryEntries("")).toEqual([]);
	});

	test("the Bots list as Pinned, then each section by name, then Other Bots, each most recent first, and as one list until any is pinned or in a section", () => {
		const placed = (id: string, at: number, pinned: boolean, section: string | null): BotRow => ({
			bot: { ...bot(null), id: id as BotId, name: id, pinned, section },
			host: null,
			unread: false,
			preview: "",
			at,
		});
		const rows = [placed("ana", 9, false, "Work"), placed("bo", 8, true, "Work"), placed("cy", 7, false, null), placed("di", 6, false, "Chores"), placed("ed", 5, false, "Work"), placed("fay", 4, true, null)];
		expect(botGroups(rows).map(group => [botGroupKey(group), botGroupLabel(group), botGroupListName(group), group.rows.map(({ bot }) => bot.name)])).toEqual([
			["pinned", "Pinned", "Pinned Bots", ["bo", "fay"]],
			["section:Chores", "Chores", "Chores Bots", ["di"]],
			["section:Work", "Work", "Work Bots", ["ana", "ed"]],
			["rest", "Other Bots", "Other Bots", ["cy"]],
		]);
		expect(botSections(rows.map(({ bot }) => bot))).toEqual(["Chores", "Work"]);
		expect(botsGrouped(rows.map(({ bot }) => bot))).toBe(true);
		expect(botsGrouped([placed("cy", 7, false, null).bot])).toBe(false);
		expect(botGroups([placed("cy", 7, false, null)]).map(botGroupKey)).toEqual(["rest"]);
	});

	test("dropping a Bot on a group pins it keeping its section, or unpins it and moves it there, and changes nothing where it already lists", () => {
		const placed = (pinned: boolean, section: string | null): Bot => ({ ...bot(null), pinned, section });
		expect(botMovesTo(placed(false, "Work"), { kind: "pinned" })).toEqual([{ op: "pin", id: scout, pinned: true }]);
		expect(botMovesTo(placed(true, "Work"), { kind: "section", name: "Work" })).toEqual([{ op: "pin", id: scout, pinned: false }]);
		expect(botMovesTo(placed(true, "Work"), { kind: "section", name: "Chores" })).toEqual([
			{ op: "pin", id: scout, pinned: false },
			{ op: "move", id: scout, section: "Chores" },
		]);
		expect(botMovesTo(placed(true, "Work"), { kind: "rest" })).toEqual([
			{ op: "pin", id: scout, pinned: false },
			{ op: "move", id: scout, section: null },
		]);
		expect(botMovesTo(placed(false, null), { kind: "section", name: "Work" })).toEqual([{ op: "move", id: scout, section: "Work" }]);
		expect(botMovesTo(placed(false, "Work"), { kind: "rest" })).toEqual([{ op: "move", id: scout, section: null }]);
		expect(botMovesTo(placed(true, null), { kind: "pinned" })).toEqual([]);
		expect(botMovesTo(placed(false, "Work"), { kind: "section", name: "Work" })).toEqual([]);
		expect(botMovesTo(placed(false, null), { kind: "rest" })).toEqual([]);
	});
});
