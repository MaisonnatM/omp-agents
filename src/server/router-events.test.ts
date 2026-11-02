import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TriggerEvent } from "../routines";
import type { BotId } from "../shared/bots";
import { type RouterTask, routerRoutine } from "../shared/router";
import { passThroughText } from "../shared/router-rules";
import { readRoutineMessage } from "../shared/routine-message";
import { RouterEvents } from "./router-events";
import { RoutineRunner } from "./routine-runner";
import { RoutinesFile } from "./routines-file";
import { RouterTasksFile } from "./router-tasks";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-11-02T09:00:00Z");
const ATLAS = "atlas" as BotId;
const SCOUT = "scout" as BotId;

const failing: TriggerEvent = { kind: "pull-request", title: "acme/app#4 has failing checks", detail: "Fix login, by ada", url: "https://github.com/acme/app/pull/4" };
const review: TriggerEvent = { kind: "pull-request", title: "acme/app#5 waits on your review", detail: "Add search, by bo", url: "https://github.com/acme/app/pull/5" };
const bug: TriggerEvent = { kind: "slack", title: "Ana mentioned you in eng", detail: "Login is broken since this morning", url: "https://acme.slack.com/archives/C0ENG/p1700000000123456" };
const thanks: TriggerEvent = { kind: "slack", title: "Bo wrote to you", detail: "thanks!", url: "https://acme.slack.com/archives/D0BO/p1700000001000000" };
const emoji: TriggerEvent = { kind: "slack", title: "Cy wrote to you", detail: ":+1:", url: "https://acme.slack.com/archives/D0CY/p1700000002000000" };

const task = (id: string, fields: Partial<RouterTask> = {}): RouterTask => ({
	id,
	botId: ATLAS,
	sessionId: `s-${id}`,
	title: `Task ${id}`,
	cwd: "/work",
	prompt: `Do ${id}.`,
	follows: [],
	status: "working",
	quiet: false,
	startedAt: T0,
	updatedAt: T0,
	restarts: 0,
	note: null,
	...fields,
});

/** A runner over Atlas's events routine, and Scout's routine on the same triggers, screened by the Router's rules and tasks. */
function harness({ refuse = null as string | null } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-router-events-"));
	dirs.push(dir);
	const routines = new RoutinesFile(join(dir, "routines.json"));
	routines.apply({ op: "save", routine: routerRoutine(ATLAS) }, T0);
	routines.apply({ op: "save", routine: { ...routerRoutine(SCOUT), id: "scout-events" } }, T0);
	const tasks = new RouterTasksFile(join(dir, "router-tasks.json"));
	const now = T0 + 60_000;
	const routed = { bots: [] as [BotId, string][], sessions: [] as [string, string][] };
	const screen = new RouterEvents({
		isRouter: botId => botId === ATLAS,
		file: tasks,
		apply: edit => tasks.apply(edit, now),
		messageSession: async (sessionId, text) => {
			if (refuse !== null) throw new Error(refuse);
			routed.sessions.push([sessionId, text]);
		},
	});
	const runner = new RoutineRunner({
		file: routines,
		now: () => now,
		workspace: () => "/work",
		exec: () => Promise.reject(new Error("no commands here")),
		fullyAwake: async () => true,
		onChange: () => {},
		messageBot: async (botId, text) => {
			routed.bots.push([botId, text]);
			return `s-${botId}`;
		},
		screen,
	});
	/** What reached Atlas's conversation: each message's events and prompt. */
	const atlas = () => routed.bots.filter(([botId]) => botId === ATLAS).map(([, text]) => readRoutineMessage(text));
	return { runner, tasks, routed, atlas, now };
}

describe("a Router's events", () => {
	test("chatter is dropped without reaching the Router, and the next message it gets counts it", async () => {
		const { runner, routed, atlas } = harness();
		await runner.fire([thanks, emoji]);
		expect(atlas()).toEqual([]);
		// Another Bot's routine on the same triggers still hears everything.
		expect(routed.bots.map(([botId, text]) => [botId, readRoutineMessage(text)?.triggeredBy])).toEqual([[SCOUT, [thanks, emoji]]]);
		await runner.fire([bug]);
		expect(atlas()[0]).toMatchObject({
			triggeredBy: [bug],
			sent: {
				kind: "prompt",
				prompt: [
					"Read the events this run names, and hand each that needs work to a task, as your job says; say nothing about the ones that need nothing from me.",
					'To follow what an event happened on, pass its follow to `start_task` or `follow`:\n- Ana mentioned you in eng: {"kind":"slack-thread","channel":"C0ENG","ts":"1700000000.123456"}',
					"2 team messages didn't need anything.",
				].join("\n\n"),
			},
		});
		// The count is told once.
		await runner.fire([review]);
		expect(atlas()[1]?.sent).toEqual({ kind: "prompt", prompt: expect.not.stringContaining("didn't need anything") });
	});

	test("an event on a pull request an open task follows goes to that task's session, not the Router", async () => {
		const { runner, tasks, routed, atlas, now } = harness();
		tasks.apply({ op: "add", task: task("t1", { status: "review", follows: [{ kind: "pull-request", owner: "Acme", repo: "App", number: 4 }] }) }, T0);
		tasks.apply({ op: "add", task: task("done", { status: "done", follows: [{ kind: "pull-request", owner: "acme", repo: "app", number: 4 }] }) }, T0);
		await runner.fire([failing]);
		expect(routed.sessions).toEqual([["s-t1", passThroughText([failing])]]);
		expect(atlas()).toEqual([]);
		expect(tasks.get("t1")).toMatchObject({ status: "working", updatedAt: now });
		expect(tasks.get("done")?.status).toBe("done");
	});

	test("an event nothing follows goes to the Router", async () => {
		const { runner, tasks, routed, atlas } = harness();
		tasks.apply({ op: "add", task: task("t1", { follows: [{ kind: "pull-request", owner: "acme", repo: "app", number: 4 }] }) }, T0);
		await runner.fire([review]);
		expect(routed.sessions).toEqual([]);
		expect(atlas().map(message => message?.triggeredBy)).toEqual([[review]]);
	});

	test("events that arrive together reach the Router in one message, without the ones a task took", async () => {
		const { runner, tasks, routed, atlas } = harness();
		tasks.apply({ op: "add", task: task("t1", { follows: [{ kind: "slack-thread", channel: "C0ENG", ts: "1700000000.123456" }] }) }, T0);
		const more = [1, 2, 3].map(n => ({ ...review, title: `acme/app#${10 + n} waits on your review`, url: `https://github.com/acme/app/pull/${10 + n}` }));
		await runner.fire([failing, bug, thanks, ...more]);
		expect(routed.sessions).toEqual([["s-t1", passThroughText([bug])]]);
		expect(atlas().map(message => message?.triggeredBy)).toEqual([[failing, ...more]]);
	});

	test("an event a task's session cannot take goes to the Router instead", async () => {
		const { runner, tasks, atlas } = harness({ refuse: "the session is gone" });
		tasks.apply({ op: "add", task: task("t1", { status: "review", follows: [{ kind: "pull-request", owner: "acme", repo: "app", number: 4 }] }) }, T0);
		await runner.fire([failing]);
		expect(atlas().map(message => message?.triggeredBy)).toEqual([[failing]]);
		expect(tasks.get("t1")?.status).toBe("review");
	});
});
