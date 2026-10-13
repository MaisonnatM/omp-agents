import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LocalEventsFile } from "./local-events-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function eventsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-events-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "events.json");
}

const timed = (start: string, end: string) => ({ allDay: false, start: Date.parse(start), end: Date.parse(end) }) as const;
const allDay = (firstDay: string, lastDay: string) => ({ allDay: true, firstDay, lastDay }) as const;

describe("LocalEventsFile", () => {
	test("an added event is kept for the next server, and a removed one is gone for it", () => {
		const path = eventsPath();
		const first = new LocalEventsFile(path);
		const lunch = first.add("Lunch", timed("2026-10-07T10:30:00Z", "2026-10-07T11:30:00Z"));
		const trip = first.add("Trip", allDay("2026-10-14", "2026-10-16"));
		expect(lunch.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		expect(new LocalEventsFile(path).value).toEqual([
			{ id: lunch.id, title: "Lunch", when: { allDay: false, start: Date.parse("2026-10-07T10:30:00Z"), end: Date.parse("2026-10-07T11:30:00Z") } },
			{ id: trip.id, title: "Trip", when: { allDay: true, firstDay: "2026-10-14", lastDay: "2026-10-16" } },
		]);

		first.apply({ op: "remove", id: lunch.id });
		first.apply({ op: "remove", id: lunch.id });
		expect(first.value.map(event => event.title)).toEqual(["Trip"]);
		expect(new LocalEventsFile(path).value.map(event => event.title)).toEqual(["Trip"]);
	});

	test("a file holding something else moves aside rather than being written over", () => {
		const path = eventsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ events: [{ id: "a", title: "Backward", when: allDay("2026-10-02", "2026-10-01") }] }));
		const file = new LocalEventsFile(path);
		expect(existsSync(`${path}.invalid`)).toBe(true);
		file.add("Fresh", allDay("2026-10-05", "2026-10-05"));
		expect(new LocalEventsFile(path).value.map(event => event.title)).toEqual(["Fresh"]);
	});

	test("an event that ends before it starts, at a time that is not a whole millisecond, or neither all-day nor timed moves the file aside", () => {
		for (const when of [timed("2026-10-07T11:30:00Z", "2026-10-07T10:30:00Z"), { allDay: false, start: 0.5, end: 1 }, { allDay: "yes", start: 0, end: 1 }]) {
			const path = eventsPath();
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, JSON.stringify({ events: [{ id: "a", title: "Bad", when }] }));
			expect(new LocalEventsFile(path).value).toEqual([]);
			expect(existsSync(`${path}.invalid`)).toBe(true);
		}
	});
});
