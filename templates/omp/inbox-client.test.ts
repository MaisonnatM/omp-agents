import { afterAll, afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inbox } from "./agent/extensions/inbox/client";

const root = mkdtempSync(join(tmpdir(), "inbox-client-"));
afterEach(() => setSystemTime());
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("two changes left in the same millisecond take the next stamp, so the dashboard and waiting read them in order", () => {
	const now = new Date("2100-01-01T00:00:00Z").getTime();
	setSystemTime(now);
	const dir = join(root, "same-millisecond");
	const changes = inbox<{ n: number }>(dir);
	changes.leave({ n: 1 });
	changes.leave({ n: 2 });
	expect(
		readdirSync(dir)
			.map(name => Number(name.split("-")[0]))
			.sort(),
	).toEqual([now, now + 1]);
	expect(changes.waiting()).toEqual([{ n: 1 }, { n: 2 }]);
});

test("waiting leaves out a file that is not a JSON object, and a missing inbox waits for nothing", () => {
	const dir = join(root, "invalid");
	const changes = inbox<{ n: number }>(dir);
	expect(changes.waiting()).toEqual([]);
	changes.leave({ n: 1 });
	writeFileSync(join(dir, "9999999999998-a.json"), "null");
	writeFileSync(join(dir, "9999999999999-b.json"), "{ not json");
	expect(changes.waiting()).toEqual([{ n: 1 }]);
});

test("a change that cannot be written says it was not left", () => {
	const file = join(root, "a-file");
	writeFileSync(file, "");
	expect(() => inbox<{ n: number }>(join(file, "inbox")).leave({ n: 1 })).toThrow(/^Cannot leave the change for the dashboard: /);
});
