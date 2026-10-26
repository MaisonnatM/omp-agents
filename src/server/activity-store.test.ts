import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActivityEvent } from "../shared/activity";
import { ActivityStore } from "./activity-store";

const CLIENT = "aaaaaaaa-0000-4000-8000-000000000000";
const dirs: string[] = [];

function open(): ActivityStore {
	const dir = mkdtempSync(join(tmpdir(), "activity-store-"));
	dirs.push(dir);
	return new ActivityStore(join(dir, "nested", "activity.db"));
}

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
		expect(store.rows(null)).toEqual(BATCH.map((event, index) => ({ client: CLIENT, seq: 4 + index, ...event })));
		store.close();
	});

	test("rows reads from the cutoff, and prune keeps a row at its cutoff", () => {
		const store = open();
		store.append(CLIENT, 0, BATCH);
		expect(store.rows(200).map(({ seq }) => seq)).toEqual([1, 2]);
		store.prune(200);
		expect(store.rows(null).map(({ at }) => at)).toEqual([200, 300]);
		store.close();
	});
});
