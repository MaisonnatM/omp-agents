import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { EMPTY_SPORT } from "../shared/sport";
import { log, measurement } from "../sport-fixtures";
import { SportFile } from "./sport-file";

const dirs: string[] = [];
afterEach(() => {
	flushJsonFiles();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sportPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-sport-"));
	dirs.push(dir);
	return join(dir, "sport.json");
}

const LOG = log("l1", "2026-11-17", { workout: "mardi", title: "Mardi", rpe: 8, pain: { level: 3, where: "fingers" }, loads: { semi: 15 }, climbs: [{ kind: "boulder", grade: "7b", color: "noir", kilter: false, attempts: 4 }], addedBy: "s1" });
const MAX = measurement("m1", "max", 117, "2026-11-17");
const METRICS = [{ id: "max", label: "Max", unit: "kg", better: "higher" as const }];

test("another server loads the saved log and measurements", () => {
	const path = sportPath();
	const file = new SportFile(path);
	expect(file.apply([{ op: "add-log", log: LOG }])).toBe(true);
	expect(file.apply([{ op: "set-metrics", metrics: METRICS }, { op: "add-measurement", measurement: MAX }])).toBe(true);
	expect(file.apply([{ op: "add-log", log: LOG }])).toBe(false);
	flushJsonFiles();
	expect(new SportFile(path).value).toEqual({ ...EMPTY_SPORT, metrics: METRICS, log: [LOG], measurements: [MAX] });
});

test("a batch with one refused change keeps none of it, and says why", () => {
	const path = sportPath();
	const file = new SportFile(path);
	expect(() => file.apply([{ op: "add-log", log: LOG }, { op: "add-measurement", measurement: MAX }])).toThrow("max");
	expect(file.value).toEqual(EMPTY_SPORT);
	flushJsonFiles();
	expect(new SportFile(path).value).toEqual(EMPTY_SPORT);
});

test("an unreadable sport file is preserved rather than overwritten", () => {
	const path = sportPath();
	writeFileSync(path, '{"v": 1, "log": ["keep this"]}');
	expect(new SportFile(path).value).toEqual(EMPTY_SPORT);
	expect(readFileSync(`${path}.invalid`, "utf8")).toBe('{"v": 1, "log": ["keep this"]}');
});

test("a file from a newer version is preserved rather than overwritten", () => {
	const path = sportPath();
	writeFileSync(path, '{"v": 2}');
	expect(new SportFile(path).value).toEqual(EMPTY_SPORT);
	expect(readFileSync(`${path}.invalid`, "utf8")).toBe('{"v": 2}');
});
