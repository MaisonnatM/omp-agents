import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseProcessSettings } from "../shared/processes";
import { ProcessSettingsFile } from "./process-settings-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function settingsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-processes-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "processes.json");
}

function writeSettings(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

describe("ProcessSettingsFile", () => {
	test("without a file the idle stops are 30 minutes and 24 hours, and a change saves it for the next server", () => {
		const path = settingsPath();
		const first = new ProcessSettingsFile(path);
		expect(first.value).toEqual({ stopIdleAfterMinutes: 30, stopIdleSessionsAfterHours: 24 });
		expect(first.apply({ stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: 24 })).toBe(true);
		expect(first.apply({ stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: 24 })).toBe(false);
		expect(new ProcessSettingsFile(path).value).toEqual({ stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: 24 });
		expect(first.apply({ stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: 72 })).toBe(true);
		expect(new ProcessSettingsFile(path).value).toEqual({ stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: 72 });
	});

	test("a file saved before the idle session stop existed keeps its process stop and takes the session stop's default", () => {
		const path = settingsPath();
		writeSettings(path, { stopIdleAfterMinutes: 60 });
		expect(new ProcessSettingsFile(path).value).toEqual({ stopIdleAfterMinutes: 60, stopIdleSessionsAfterHours: 24 });
		expect(existsSync(`${path}.invalid`)).toBe(false);
	});

	test("a file that names a stop the page does not offer moves aside rather than being written over", () => {
		const path = settingsPath();
		writeSettings(path, { stopIdleAfterMinutes: 30, stopIdleSessionsAfterHours: 7 });
		expect(new ProcessSettingsFile(path).value).toEqual({ stopIdleAfterMinutes: 30, stopIdleSessionsAfterHours: 24 });
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});
});

describe("parseProcessSettings", () => {
	test("takes off or one of the offered stops for both, and nothing else", () => {
		expect(parseProcessSettings({ stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: null })).toEqual({ ok: { stopIdleAfterMinutes: null, stopIdleSessionsAfterHours: null } });
		expect(parseProcessSettings({ stopIdleAfterMinutes: 15, stopIdleSessionsAfterHours: 4 })).toEqual({ ok: { stopIdleAfterMinutes: 15, stopIdleSessionsAfterHours: 4 } });
		expect(parseProcessSettings({ stopIdleAfterMinutes: 45, stopIdleSessionsAfterHours: 24 })).toBeNull();
		expect(parseProcessSettings({ stopIdleAfterMinutes: 30, stopIdleSessionsAfterHours: 6 })).toBeNull();
		expect(parseProcessSettings({ stopIdleAfterMinutes: "30", stopIdleSessionsAfterHours: 24 })).toBeNull();
		expect(parseProcessSettings({ stopIdleAfterMinutes: 30 })).toBeNull();
		expect(parseProcessSettings({})).toBeNull();
		expect(parseProcessSettings(null)).toBeNull();
	});
});
