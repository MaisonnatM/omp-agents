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

describe("ProcessSettingsFile", () => {
	test("without a file the idle stop is 30 minutes, and a change saves it for the next server", () => {
		const path = settingsPath();
		const first = new ProcessSettingsFile(path);
		expect(first.value).toEqual({ stopIdleAfterMinutes: 30 });
		expect(first.apply({ stopIdleAfterMinutes: null })).toBe(true);
		expect(first.apply({ stopIdleAfterMinutes: null })).toBe(false);
		expect(new ProcessSettingsFile(path).value).toEqual({ stopIdleAfterMinutes: null });
		expect(first.apply({ stopIdleAfterMinutes: 120 })).toBe(true);
		expect(new ProcessSettingsFile(path).value).toEqual({ stopIdleAfterMinutes: 120 });
	});

	test("a file that names a stop the page does not offer moves aside rather than being written over", () => {
		const path = settingsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ stopIdleAfterMinutes: 7 }));
		expect(new ProcessSettingsFile(path).value).toEqual({ stopIdleAfterMinutes: 30 });
		expect(existsSync(`${path}.invalid`)).toBe(true);
	});
});

describe("parseProcessSettings", () => {
	test("takes off or one of the offered stops, and nothing else", () => {
		expect(parseProcessSettings({ stopIdleAfterMinutes: null })).toEqual({ ok: { stopIdleAfterMinutes: null } });
		expect(parseProcessSettings({ stopIdleAfterMinutes: 15 })).toEqual({ ok: { stopIdleAfterMinutes: 15 } });
		expect(parseProcessSettings({ stopIdleAfterMinutes: 45 })).toBeNull();
		expect(parseProcessSettings({ stopIdleAfterMinutes: "30" })).toBeNull();
		expect(parseProcessSettings({})).toBeNull();
		expect(parseProcessSettings(null)).toBeNull();
	});
});
