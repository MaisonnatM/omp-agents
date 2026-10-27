import { describe, expect, test } from "bun:test";
import { type ActivityBatch, commandKey, controlOf, createRecorder, listenForControls, MAX_OUTBOX, OUTBOX_STORAGE_KEY, type PendingEvent, viewOf } from "./activity";
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
		expect(pageView({ kind: "bots", target: null, adding: false })).toBe("bots");
		expect(pageView({ kind: "bots", target: null, adding: true })).toBe("bots/new");
		expect(pageView({ kind: "bots", target: "b1", routine: null })).toBe("bots/item");
		expect(pageView({ kind: "bots", target: "b1", routine: { kind: "list" } })).toBe("bots/routines");
		expect(pageView({ kind: "bots", target: "b1", routine: { kind: "open", id: "r1" } })).toBe("bots/routine");
		expect(pageView({ kind: "calendar" })).toBe("calendar");
		expect(pageView({ kind: "email", target: null })).toBe("email");
		expect(pageView({ kind: "email", target: "new" })).toBe("email/new");
		expect(pageView({ kind: "email", target: { account: "a", thread: "t" } } as Page)).toBe("email/item");
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

function fakeStorage(initial: unknown[] = []) {
	const items = new Map([[OUTBOX_STORAGE_KEY, JSON.stringify(initial)]]);
	return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), outbox: (): PendingEvent[] => JSON.parse(items.get(OUTBOX_STORAGE_KEY)!) };
}

const EARLIER = "aaaaaaaa-0000-4000-8000-000000000000";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000000";
const left = (client: string, seq: number): PendingEvent => ({ client, seq, event: { kind: "view", key: "home", via: null, at: 1 } });

describe("createRecorder", () => {
	test("a new page load resends what an earlier one left, under its original client and sequence", async () => {
		const storage = fakeStorage([left(EARLIER, 7)]);
		const sent: ActivityBatch[] = [];
		const recorder = createRecorder({ now: () => 5, storage, connected: () => true, send: async batch => void sent.push(batch), automated: false });
		recorder.record("command", "help", "keyboard");
		await recorder.flush();
		expect(sent[0]).toEqual({ t: "activity", client: EARLIER, first: 7, events: [left(EARLIER, 7).event] });
		expect(sent[1]).toMatchObject({ first: 0, events: [{ kind: "command", key: "help", via: "keyboard", at: 5 }] });
		expect(sent[1]!.client).not.toBe(EARLIER);
		expect(storage.outbox()).toEqual([]);
	});

	test("offline, the outbox keeps every batch for the next flush", async () => {
		const storage = fakeStorage();
		let connected = false;
		const sent: ActivityBatch[] = [];
		const recorder = createRecorder({ now: () => 1, storage, connected: () => connected, send: async batch => void sent.push(batch), automated: false });
		recorder.record("view", "home");
		await recorder.flush();
		expect(sent).toEqual([]);
		expect(storage.outbox()).toHaveLength(1);
		connected = true;
		await recorder.flush();
		expect(sent).toHaveLength(1);
		expect(storage.outbox()).toEqual([]);
	});

	test("a batch the server refused is dropped, and the batches after it still go", async () => {
		const storage = fakeStorage([left(EARLIER, 0), left(OTHER, 0)]);
		const sent: string[] = [];
		const recorder = createRecorder({ now: () => 1, storage, connected: () => true, send: async batch => {
			if (batch.client === EARLIER) throw new Error("refused");
			sent.push(batch.client);
		}, automated: false });
		await recorder.flush();
		expect(sent).toEqual([OTHER]);
		expect(storage.outbox()).toEqual([]);
	});

	test("a kept entry the server would refuse, such as one an older version kept, is not loaded", async () => {
		const storage = fakeStorage([{ client: EARLIER, seq: 0, event: { kind: "view", key: "/Users/me/secret", via: null, at: 1 } }, left(OTHER, 3), "junk"]);
		const sent: ActivityBatch[] = [];
		const recorder = createRecorder({ now: () => 1, storage, connected: () => true, send: async batch => void sent.push(batch), automated: false });
		await recorder.flush();
		expect(sent).toEqual([{ t: "activity", client: OTHER, first: 3, events: [left(OTHER, 3).event] }]);
	});

	test("recording saves nothing until a flush or persist, and past the cap the oldest events go first", () => {
		const storage = fakeStorage();
		const recorder = createRecorder({ now: () => 1, storage, connected: () => true, send: async () => {}, automated: false });
		for (let i = 0; i < MAX_OUTBOX + 2; i++) recorder.record("view", "home");
		expect(storage.outbox()).toEqual([]);
		recorder.persist();
		const outbox = storage.outbox();
		expect(outbox).toHaveLength(MAX_OUTBOX);
		expect(outbox[0]!.seq).toBe(2);
	});

	test("a key that could hold content is never kept", () => {
		const storage = fakeStorage();
		const recorder = createRecorder({ now: () => 1, storage, connected: () => true, send: async () => {}, automated: false });
		recorder.record("view", "ENG-12");
		recorder.persist();
		expect(storage.outbox()).toEqual([]);
	});

	test("a browser under automation records nothing", () => {
		const storage = fakeStorage();
		const recorder = createRecorder({ now: () => 1, storage, connected: () => true, send: async () => {}, automated: true });
		recorder.record("view", "home");
		recorder.persist();
		expect(storage.outbox()).toEqual([]);
	});
});

describe("controlOf", () => {
	// The tests run with no DOM, so the nearest tagged ancestor is `Element.closest`'s to find; only what is no element is checked here.
	test("a target that is no element names no control", () => {
		expect(controlOf(null)).toBeNull();
		expect(controlOf({} as EventTarget)).toBeNull();
	});

	test("the listener records nothing for such a click", () => {
		const recorded: string[] = [];
		let handler: ((event: Event) => void) | null = null;
		listenForControls({ addEventListener: (_type: string, listener: (event: Event) => void) => void (handler = listener), removeEventListener: () => {} } as unknown as Document, id => recorded.push(id));
		handler!({ target: null } as unknown as Event);
		expect(recorded).toEqual([]);
	});
});
