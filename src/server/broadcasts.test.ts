import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import type { ServerMsg } from "../shared/protocol";
import type { PastSession, RosterHost } from "../shared/sessions";
import { Broadcasts } from "./broadcasts";
import { ListRegistry } from "./list-registry";
import { PinsFile } from "./pins-file";
import { ProjectsFile } from "./projects-file";
import { RequestLedger } from "./request-ledger";
import { ReviewDraftsFile } from "./review-drafts-file";
import { RoutinesFile } from "./routines-file";
import { ScheduledFile } from "./scheduled-file";
import { createClientHandler, type SocketEnv } from "./socket";
import { UserTodosFile } from "./user-todos-file";
import { WorkspacesFile } from "./workspaces-file";
import type { Socket, SocketData } from "./views";

/** Only the fields the broadcast compares; the rest of a past row does not matter here. */
const past = (sessionId: string, title: string): PastSession => ({ sessionId, title }) as unknown as PastSession;
/** Only the fields the broadcast compares. */
const host = (instanceId: string, cwd: string): RosterHost => ({ instanceId, cwd }) as unknown as RosterHost;

const dirs: string[] = [];
afterEach(() => {
	flushJsonFiles();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(initial: PastSession[]) {
	let sessions = initial;
	let roster: { hosts: RosterHost[]; error: string | null } = { hosts: [], error: null };
	let listeners = 0;
	const published: ServerMsg[] = [];
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-lists-"));
	dirs.push(dir);
	const todos = new UserTodosFile(join(dir, "todos.json"));
	const routines = new RoutinesFile(join(dir, "routines.json"));
	const scheduled = new ScheduledFile(join(dir, "scheduled.json"));
	const workspaces = new WorkspacesFile(join(dir, "workspaces.json"));
	const pins = new PinsFile(join(dir, "pins.json"));
	const projects = new ProjectsFile(join(dir, "projects.json"));
	const reviewDrafts = new ReviewDraftsFile(join(dir, "review-drafts.json"));
	const lists = new ListRegistry({
		"user-todos": { msg: () => ({ t: "user-todos", list: todos.value }), apply: change => todos.apply(change) },
		routines: { msg: () => ({ t: "routines", routines: routines.value }), apply: change => routines.apply(change, 1000) },
		scheduled: { msg: () => ({ t: "scheduled", sends: scheduled.value }), apply: change => scheduled.apply(change, 1000) },
		workspaces: {
			msg: () => ({
				t: "workspaces",
				list: {
					added: workspaces.value.added.map(cwd => ({ cwd, cwdDisplay: cwd })),
					hidden: workspaces.value.hidden.map(cwd => ({ cwd, cwdDisplay: cwd })),
				},
			}),
			apply: change => workspaces.apply(change),
		},
		pins: { msg: () => ({ t: "pins", sessionIds: pins.value }), apply: change => pins.apply(change) },
		projects: { msg: () => ({ t: "projects", projects: projects.value }), apply: change => projects.apply(change) },
		"review-drafts": { msg: () => ({ t: "review-drafts", list: reviewDrafts.value.drafts }), apply: change => reviewDrafts.apply(change) },
		notices: { msg: () => ({ t: "notices", list: [] }) },
		merges: { msg: () => ({ t: "merges", list: [] }) },
	}, kind => broadcasts.pushList(kind));
	const broadcasts = new Broadcasts({
		roster: () => roster,
		past: () => sessions,
		lists,
		publish: (_topic, json) => void published.push(JSON.parse(json)),
		subscriberCount: () => listeners,
		beforeRosterPush: () => {},
		saveRunning: () => {},
	});
	const sent: ServerMsg[] = [];
	const ws = {
		data: { views: new Map() } as SocketData,
		send: (raw: string) => void sent.push(JSON.parse(raw)),
		subscribe: () => void listeners++,
	} as unknown as Socket;
	const pastPublished = () => published.filter(msg => msg.t === "past");
	const rosterPublished = () => published.filter(msg => msg.t === "roster");
	return {
		broadcasts,
		ws,
		lists,
		pins,
		scheduled,
		published,
		sent,
		pastPublished,
		rosterPublished,
		setSessions: (next: PastSession[]) => void (sessions = next),
		setRoster: (next: { hosts: RosterHost[]; error: string | null }) => void (roster = next),
	};
}

describe("past list broadcasts", () => {
	test("a socket that opens gets the whole list, and the listeners then hear only the sessions that changed, joined, or left", () => {
		const { broadcasts, ws, sent, pastPublished, setSessions } = setup([past("a", "one"), past("b", "two")]);
		broadcasts.open(ws);
		expect(sent.find(msg => msg.t === "past")).toEqual({ t: "past", reset: true, sessions: [past("a", "one"), past("b", "two")], removed: [] });

		broadcasts.pushPast();
		expect(pastPublished()).toEqual([]);

		setSessions([past("a", "one, renamed"), past("c", "three")]);
		broadcasts.pushPast();
		expect(pastPublished()).toEqual([{ t: "past", reset: false, sessions: [past("a", "one, renamed"), past("c", "three")], removed: ["b"] }]);
	});

	test("a socket that opens after changes nobody heard gets them in its whole list, with no delta published", () => {
		const { broadcasts, ws, sent, pastPublished, setSessions } = setup([past("a", "one")]);
		setSessions([past("b", "two")]);
		broadcasts.pushPast();
		broadcasts.open(ws);
		expect(pastPublished()).toEqual([]);
		expect(sent.find(msg => msg.t === "past")).toEqual({ t: "past", reset: true, sessions: [past("b", "two")], removed: [] });
	});
});

describe("roster broadcasts", () => {
	test("a socket that opens gets the whole roster, and the listeners then hear only the rows that changed, joined, or left, and an error that changed", () => {
		const { broadcasts, ws, sent, rosterPublished, setRoster } = setup([]);
		setRoster({ hosts: [host("a", "/work"), host("b", "/other")], error: null });
		broadcasts.open(ws);
		expect(sent.find(msg => msg.t === "roster")).toEqual({ t: "roster", reset: true, hosts: [host("a", "/work"), host("b", "/other")], removed: [], error: null });

		broadcasts.pushRoster();
		expect(rosterPublished()).toEqual([]);

		setRoster({ hosts: [host("a", "/moved"), host("c", "/new")], error: null });
		broadcasts.pushRoster();
		expect(rosterPublished()).toEqual([{ t: "roster", reset: false, hosts: [host("a", "/moved"), host("c", "/new")], removed: ["b"], error: null }]);

		setRoster({ hosts: [host("a", "/moved"), host("c", "/new")], error: "registry down" });
		broadcasts.pushRoster();
		expect(rosterPublished()[1]).toEqual({ t: "roster", reset: false, hosts: [], removed: [], error: "registry down" });
	});

	test("a socket that connects again gets the whole roster, with the rows nobody heard in it", () => {
		const { broadcasts, ws, sent, rosterPublished, setRoster } = setup([]);
		setRoster({ hosts: [host("a", "/work")], error: null });
		broadcasts.open(ws);
		setRoster({ hosts: [host("b", "/other")], error: null });
		broadcasts.open(ws);
		expect(rosterPublished()).toEqual([{ t: "roster", reset: false, hosts: [host("b", "/other")], removed: ["a"], error: null }]);
		expect(sent.filter(msg => msg.t === "roster").at(-1)).toEqual({ t: "roster", reset: true, hosts: [host("b", "/other")], removed: [], error: null });
	});
});

describe("registered whole-list broadcasts", () => {
	test("every registered list is included in an opening snapshot, even before any publish", () => {
		const { broadcasts, ws, sent, lists } = setup([]);
		lists.apply("pins", { op: "pin", sessionIds: ["saved"] });
		broadcasts.open(ws);
		expect(sent.slice(2)).toEqual([...lists.messages()]);
		expect(sent.find(msg => msg.t === "pins")).toEqual({ t: "pins", sessionIds: ["saved"] });
	});

	test("an edit publishes the whole current list once; repeat edits resend only to their peer", () => {
		const { lists, published, broadcasts, ws } = setup([]);
		broadcasts.open(ws);
		const replies: ServerMsg[] = [];
		const peer = { send: (msg: ServerMsg) => void replies.push(msg) };
		expect(lists.apply("pins", { op: "pin", sessionIds: ["a"] }, peer)).toBe(true);
		expect(published).toEqual([{ t: "pins", sessionIds: ["a"] }]);
		expect(replies).toEqual([]);

		expect(lists.apply("pins", { op: "pin", sessionIds: ["a"] }, peer)).toBe(false);
		expect(replies).toEqual([{ t: "pins", sessionIds: ["a"] }]);
		broadcasts.pushList("pins");
		expect(published).toHaveLength(1);
	});

	test("every editable registration resends its authoritative snapshot after a no-op", () => {
		const { lists, published } = setup([]);
		const replies: ServerMsg[] = [];
		const peer = { send: (msg: ServerMsg) => void replies.push(msg) };
		expect(lists.apply("user-todos", { op: "remove", id: "missing" }, peer)).toBe(false);
		expect(lists.apply("routines", { op: "remove", id: "missing" }, peer)).toBe(false);
		expect(lists.apply("scheduled", { op: "remove", id: "missing" }, peer)).toBe(false);
		expect(lists.apply("workspaces", { op: "show", cwd: "/missing" }, peer)).toBe(false);
		expect(lists.apply("pins", { op: "unpin", sessionIds: ["missing"] }, peer)).toBe(false);
		expect(lists.apply("projects", { op: "rename", id: "missing", name: "new" }, peer)).toBe(false);
		expect(lists.apply("review-drafts", { op: "discard", pr: { owner: "o", repo: "r", number: 1 } }, peer)).toBe(false);
		expect(replies).toEqual([...lists.messages()].filter(msg => msg.t !== "notices" && msg.t !== "merges"));
		expect(published).toEqual([]);
	});

	test("runner-side store changes use the same message builder as snapshots and peer resends", () => {
		const { lists, pins, published, broadcasts, ws, sent } = setup([]);
		pins.apply({ op: "pin", sessionIds: ["run"] });
		broadcasts.pushList("pins");
		broadcasts.pushList("pins");
		broadcasts.open(ws);
		const replies: ServerMsg[] = [];
		lists.apply("pins", { op: "pin", sessionIds: ["run"] }, { send: msg => void replies.push(msg) });
		expect(published).toEqual([{ t: "pins", sessionIds: ["run"] }]);
		expect(replies).toEqual(published);
		expect(sent.find(msg => msg.t === "pins")).toEqual({ t: "pins", sessionIds: ["run"] });
	});

	test("a take answers the page once the send is off the list, and refuses one under way with why, leaving it scheduled", async () => {
		const { lists, scheduled, published, broadcasts, ws } = setup([]);
		broadcasts.open(ws);
		const send = (id: string) => ({ id, at: 2000, reset: null, target: { kind: "message" as const, sessionId: "s1", text: id } });
		lists.apply("scheduled", { op: "add", send: send("waiting") });
		lists.apply("scheduled", { op: "add", send: send("going") });
		scheduled.claim("going");
		published.length = 0;
		const answers: ServerMsg[] = [];
		const page = { data: { views: new Map(), pageId: "page" }, send: (raw: string) => void answers.push(JSON.parse(raw)) } as unknown as Socket;
		const ledger = new RequestLedger(createClientHandler({ lists } as SocketEnv), () => {});
		ledger.open(page);
		await ledger.handle(page, { t: "resume", frames: [] });

		await ledger.handle(page, { t: "schedule", change: { op: "take", id: "waiting" }, ack: 1, floor: 1 });
		await ledger.handle(page, { t: "schedule", change: { op: "take", id: "going" }, ack: 2, floor: 2 });
		expect(answers).toEqual([
			{ t: "done", ack: 1, error: null },
			{ t: "done", ack: 2, error: "It is already sending." },
		]);
		expect(published.map(msg => (msg.t === "scheduled" ? msg.sends.map(({ id, state }) => [id, state.phase]) : msg.t))).toEqual([[["going", "sending"]]]);
		expect(scheduled.value.map(({ id, state }) => [id, state.phase])).toEqual([["going", "sending"]]);
	});
});
