import { describe, expect, test } from "bun:test";
import { type ActivityBatch, commandKey, createRecorder, listenForControls, MAX_OUTBOX, OUTBOX_STORAGE_KEY, type PendingEvent, viewOf } from "./activity";
import type { Page } from "./routing";

const live = { kind: "live", instanceId: "i1", agentId: null } as const;
const past = { kind: "past", sessionId: "s1" } as const;
const pr = { owner: "o", repo: "r", number: 1 };
const pageView = (page: Page): string => viewOf({ kind: "page", page }, { panes: [] });

describe("viewOf", () => {
	test("names each page by its kind and whether it shows one item, never an id", () => {
		expect(pageView({ kind: "settings", section: "sync" })).toBe("settings/sync");
		expect(pageView({ kind: "pull-requests", target: null })).toBe("pull-requests");
		expect(pageView({ kind: "pull-requests", target: pr, files: null } as Page)).toBe("pull-requests/item");
		expect(pageView({ kind: "pull-requests", target: pr, files: { path: null } } as Page)).toBe("pull-requests/files");
		expect(pageView({ kind: "tickets", target: null })).toBe("tickets");
		expect(pageView({ kind: "tickets", target: "ENG-12" })).toBe("tickets/item");
		expect(pageView({ kind: "todo", list: { kind: "all" }, open: null })).toBe("todo");
		expect(pageView({ kind: "todo", list: { kind: "today" }, open: "t1" })).toBe("todo/item");
		expect(pageView({ kind: "notes", list: { kind: "all" }, open: null })).toBe("notes");
		expect(pageView({ kind: "notes", list: { kind: "agents" }, open: "n1" })).toBe("notes/item");
		expect(pageView({ kind: "routines", target: null })).toBe("routines");
		expect(pageView({ kind: "routines", target: "r1" })).toBe("routines/item");
		expect(pageView({ kind: "projects", target: { kind: "list" } })).toBe("projects");
		expect(pageView({ kind: "projects", target: { kind: "new" } })).toBe("projects/new");
		expect(pageView({ kind: "projects", target: { kind: "project", id: "p1" } })).toBe("projects/item");
		expect(pageView({ kind: "calendar" })).toBe("calendar");
		expect(pageView({ kind: "inbox", target: null })).toBe("inbox");
		expect(pageView({ kind: "inbox", target: "new" })).toBe("inbox/new");
		expect(pageView({ kind: "inbox", target: { account: "a", thread: "t" } } as Page)).toBe("inbox/item");
		expect(pageView({ kind: "new", cwd: "/Users/me/code", todoId: null })).toBe("new");
		expect(pageView({ kind: "scheduled", id: null })).toBe("scheduled");
		expect(pageView({ kind: "scheduled", id: "s1" })).toBe("scheduled/item");
	});

	test("names the panes by how many there are and of what kind", () => {
		expect(viewOf(null, { panes: [] })).toBe("home");
		expect(viewOf(null, { panes: [live] })).toBe("session");
		expect(viewOf(null, { panes: [past] })).toBe("past");
		expect(viewOf(null, { panes: [live, past] })).toBe("split");
		expect(viewOf({ kind: "session", sessionId: "s1" }, { panes: [] })).toBe("session");
	});

	test("a command's key is its shortcut id in kebab case", () => {
		expect(commandKey("newSession")).toBe("new-session");
		expect(commandKey("tab1")).toBe("tab1");
	});
});

function fakeStorage(initial: PendingEvent[] = []) {
	const items = new Map([[OUTBOX_STORAGE_KEY, JSON.stringify(initial)]]);
	return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), outbox: (): PendingEvent[] => JSON.parse(items.get(OUTBOX_STORAGE_KEY)!) };
}

describe("createRecorder", () => {
	test("a new page load resends what an earlier one left, under its original client and sequence", async () => {
		const earlier = "aaaaaaaa-0000-4000-8000-000000000000";
		const left: PendingEvent[] = [{ client: earlier, seq: 7, event: { kind: "view", key: "home", via: null, at: 1 } }];
		const storage = fakeStorage(left);
		const sent: ActivityBatch[] = [];
		const recorder = createRecorder({ now: () => 5, storage, send: async batch => void sent.push(batch), automated: false });
		recorder.record("command", "help", "keyboard");
		await recorder.flush();
		expect(sent[0]).toEqual({ t: "activity", client: earlier, first: 7, events: [left[0]!.event] });
		expect(sent[1]).toMatchObject({ first: 0, events: [{ kind: "command", key: "help", via: "keyboard", at: 5 }] });
		expect(sent[1]!.client).not.toBe(earlier);
		expect(storage.outbox()).toEqual([]);
	});

	test("a batch the server has not acknowledged stays for the next flush", async () => {
		const storage = fakeStorage();
		let fail = true;
		const sent: ActivityBatch[] = [];
		const recorder = createRecorder({ now: () => 1, storage, send: async batch => {
			if (fail) throw new Error("Not connected to the server.");
			sent.push(batch);
		}, automated: false });
		recorder.record("view", "home");
		await recorder.flush();
		expect(storage.outbox()).toHaveLength(1);
		fail = false;
		await recorder.flush();
		expect(sent).toHaveLength(1);
		expect(storage.outbox()).toEqual([]);
	});

	test("past the cap the oldest events go first", () => {
		const storage = fakeStorage();
		const recorder = createRecorder({ now: () => 1, storage, send: async () => {}, automated: false });
		for (let i = 0; i < MAX_OUTBOX + 2; i++) recorder.record("view", "home");
		const outbox = storage.outbox();
		expect(outbox).toHaveLength(MAX_OUTBOX);
		expect(outbox[0]!.seq).toBe(2);
	});

	test("a browser under automation records nothing", () => {
		const storage = fakeStorage();
		const recorder = createRecorder({ now: () => 1, storage, send: async () => {}, automated: true });
		recorder.record("view", "home");
		expect(storage.outbox()).toEqual([]);
	});
});

describe("listenForControls", () => {
	interface FakeElement {
		id: string | null;
		parent: FakeElement | null;
		closest(selector: string): { getAttribute(name: string): string | null } | null;
	}
	const element = (id: string | null, parent: FakeElement | null = null): FakeElement => ({
		id,
		parent,
		closest() {
			for (let node: FakeElement | null = this; node; node = node.parent) if (node.id !== null) return { getAttribute: () => node!.id };
			return null;
		},
	});
	function clicks(target: FakeElement): string[] {
		const recorded: string[] = [];
		let handler: ((event: Event) => void) | null = null;
		listenForControls({ addEventListener: (_type: string, listener: (event: Event) => void) => void (handler = listener), removeEventListener: () => {} } as unknown as Document, id => recorded.push(id));
		handler!({ target } as unknown as Event);
		return recorded;
	}

	test("a click on an icon inside a tagged button records that button once", () => {
		expect(clicks(element(null, element("trajectory.toggle")))).toEqual(["trajectory.toggle"]);
	});

	test("nested tags record the nearest only", () => {
		expect(clicks(element(null, element("pr-details.tab.code", element("pr-details.open"))))).toEqual(["pr-details.tab.code"]);
	});

	test("an untagged click records nothing", () => {
		expect(clicks(element(null, element(null)))).toEqual([]);
	});
});
