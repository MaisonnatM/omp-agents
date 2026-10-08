import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CalendarsFile } from "./calendars-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function calendarsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-calendars-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "calendars.json");
}

describe("CalendarsFile", () => {
	test("hiding or showing a calendar changes only once, and the next server reads the result", () => {
		const path = calendarsPath();
		const first = new CalendarsFile(path);
		expect(first.setShown("team@group.calendar.google.com", true)).toBe(false);
		expect(first.setShown("team@group.calendar.google.com", false)).toBe(true);
		expect(first.setShown("team@group.calendar.google.com", false)).toBe(false);
		expect(first.setShown("holidays@group.v.calendar.google.com", false)).toBe(true);
		expect([...new CalendarsFile(path).hidden]).toEqual(["team@group.calendar.google.com", "holidays@group.v.calendar.google.com"]);
		expect(first.setShown("team@group.calendar.google.com", true)).toBe(true);
		expect([...new CalendarsFile(path).hidden]).toEqual(["holidays@group.v.calendar.google.com"]);
	});

	test("a file holding something else moves aside rather than being written over", () => {
		const path = calendarsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ hidden: "team@group.calendar.google.com" }));
		const file = new CalendarsFile(path);
		expect(existsSync(`${path}.invalid`)).toBe(true);
		expect(file.setShown("team@group.calendar.google.com", false)).toBe(true);
		expect([...new CalendarsFile(path).hidden]).toEqual(["team@group.calendar.google.com"]);
	});
});
