import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ActivityEvent } from "../shared/activity";
import { ActivityStore } from "./activity-store";

const CLIENT = "aaaaaaaa-0000-4000-8000-000000000000";
const dirs: string[] = [];

function storePath(): string {
	const dir = mkdtempSync(join(tmpdir(), "activity-store-"));
	dirs.push(dir);
	return join(dir, "nested", "activity.db");
}

const open = (): ActivityStore => new ActivityStore(storePath());

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BATCH: ActivityEvent[] = [
	{ kind: "view", key: "home", via: null, at: 100 },
	{ kind: "command", key: "help", via: "keyboard", at: 200 },
	{ kind: "action", key: "pin", via: null, at: 300 },
];

describe("ActivityStore", () => {
	test("a batch appended twice is stored once", () => {
		const store = open();
		store.append(CLIENT, 4, BATCH);
		store.append(CLIENT, 4, BATCH);
		expect(store.rows(0)).toEqual(BATCH.map((event, index) => ({ client: CLIENT, seq: 4 + index, ...event })));
		store.close();
	});

	test("rows reads from the cutoff, and prune keeps a row at its cutoff", () => {
		const store = open();
		store.append(CLIENT, 0, BATCH);
		expect(store.rows(200).map(({ seq }) => seq)).toEqual([1, 2]);
		store.prune(200);
		expect(store.rows(0).map(({ at }) => at)).toEqual([200, 300]);
		store.close();
	});

	test("lastUsed answers each feature's latest use over every row, leaving presence out", () => {
		const store = open();
		store.append(CLIENT, 0, [...BATCH, { kind: "view", key: "home", via: null, at: 400 }, { kind: "presence", key: "background", via: null, at: 500 }]);
		expect(store.lastUsed().toSorted((a, b) => a.at - b.at)).toEqual([
			{ kind: "command", key: "help", at: 200 },
			{ kind: "action", key: "pin", at: 300 },
			{ kind: "view", key: "home", at: 400 },
		]);
		store.close();
	});

	test("opening a store from before the Email page renames its Inbox views and commands once, and a later inbox row keeps its key", () => {
		const path = storePath();
		mkdirSync(dirname(path));
		const legacy = new Database(path, { create: true });
		legacy.run("CREATE TABLE activity (client TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, via TEXT, PRIMARY KEY (client, seq)) WITHOUT ROWID");
		const rows: [string, string][] = [
			["view", "inbox"],
			["view", "inbox/new"],
			["view", "inbox/item"],
			["view", "inboxes"],
			["command", "inbox"],
			["command", "inbox-reply-all"],
			["command", "inbox/new"],
			["action", "inbox"],
			["view", "notes"],
		];
		rows.forEach(([kind, key], seq) => legacy.run("INSERT INTO activity (client, seq, at, kind, key, via) VALUES (?, ?, ?, ?, ?, NULL)", [CLIENT, seq, 100, kind, key]));
		legacy.close();

		const store = new ActivityStore(path);
		expect(store.rows(0).map(({ kind, key }) => `${kind} ${key}`)).toEqual([
			"view email",
			"view email/new",
			"view email/item",
			"view inboxes",
			"command email",
			"command email-reply-all",
			"command inbox/new",
			"action inbox",
			"view notes",
		]);
		store.append(CLIENT, 100, [
			{ kind: "view", key: "inbox", via: null, at: 200 },
			{ kind: "command", key: "inbox-next", via: "keyboard", at: 200 },
		]);
		store.close();

		const reopened = new ActivityStore(path);
		expect(reopened.rows(200).map(({ kind, key }) => `${kind} ${key}`)).toEqual(["view inbox", "command inbox-next"]);
		reopened.close();
	});
});
