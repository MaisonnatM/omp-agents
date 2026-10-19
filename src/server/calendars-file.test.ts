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

const hiddenOf = (file: CalendarsFile): Record<string, string[]> => Object.fromEntries([...file.value].map(([account, ids]) => [account, [...ids]]));

describe("CalendarsFile", () => {
	test("hiding or showing a calendar changes only its account's list, only once, and the next server reads the result", () => {
		const path = calendarsPath();
		const first = new CalendarsFile(path);
		expect(first.apply("google-calendar", "team@group.calendar.google.com", true)).toBe(false);
		expect(first.apply("google-calendar", "team@group.calendar.google.com", false)).toBe(true);
		expect(first.apply("google-calendar", "team@group.calendar.google.com", false)).toBe(false);
		expect(first.apply("google-calendar-2", "team@group.calendar.google.com", false)).toBe(true);
		expect(hiddenOf(new CalendarsFile(path))).toEqual({ "google-calendar": ["team@group.calendar.google.com"], "google-calendar-2": ["team@group.calendar.google.com"] });
		expect(first.apply("google-calendar", "team@group.calendar.google.com", true)).toBe(true);
		expect(hiddenOf(new CalendarsFile(path))).toEqual({ "google-calendar-2": ["team@group.calendar.google.com"] });
	});

	test("a file from before accounts goes to the first Google Calendar server whatever its name, once, beside what that server hides since", () => {
		const path = calendarsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ hidden: ["team@group.calendar.google.com"] }));
		const file = new CalendarsFile(path);
		expect(existsSync(`${path}.invalid`)).toBe(false);
		expect(file.apply("gcal", "holidays@group.v.calendar.google.com", false)).toBe(true);
		expect(file.adopt("gcal")).toBe(true);
		expect(file.adopt("google-calendar")).toBe(false);
		expect(hiddenOf(new CalendarsFile(path))).toEqual({ gcal: ["holidays@group.v.calendar.google.com", "team@group.calendar.google.com"] });
	});

	test("a file holding something else moves aside rather than being written over", () => {
		const path = calendarsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ hidden: "team@group.calendar.google.com" }));
		const file = new CalendarsFile(path);
		expect(existsSync(`${path}.invalid`)).toBe(true);
		expect(file.apply("google-calendar", "team@group.calendar.google.com", false)).toBe(true);
		expect(hiddenOf(new CalendarsFile(path))).toEqual({ "google-calendar": ["team@group.calendar.google.com"] });
	});
});
