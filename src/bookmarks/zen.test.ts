import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeTempDirs, tempDir, withCookies, zenProfile } from "./fixtures";
import { readXCookies, readZenBookmarks, zenProfileDir } from "./zen";

afterEach(removeTempDirs);

test("reads each page bookmark with its folders, and skips tags and queries", () => {
	expect(readZenBookmarks(zenProfile())).toEqual([
		{ source: "zen", id: "zen:figmabookmrk", url: "https://figma.com", title: "Figma", folder: ["Toolbar", "Design"], addedAt: "2023-11-14T22:13:20.000Z" },
		{ source: "zen", id: "zen:bunbookmark_", url: "https://bun.sh", title: "Bun runtime", folder: ["Other"], addedAt: "2024-03-09T16:00:00.000Z" },
	]);
});

test("finds the profile the install opens", () => {
	const dir = tempDir();
	mkdirSync(join(dir, "Profiles", "abc.Default (release)"), { recursive: true });
	writeFileSync(join(dir, "profiles.ini"), "[Install1]\nDefault=Profiles/abc.Default (release)\n\n[Profile0]\nName=Other\nIsRelative=1\nPath=Profiles/other\nDefault=1\n");
	expect(zenProfileDir(dir)).toBe(join(dir, "Profiles", "abc.Default (release)"));
	expect(zenProfileDir(join(dir, "missing"))).toBeNull();
});

test("reads the newest x.com sign-in cookies", () => {
	const profile = tempDir();
	withCookies(profile, [
		["ct0", "old", ".x.com", 1],
		["ct0", "new", ".x.com", 2],
		["auth_token", "token", ".x.com", 1],
		["auth_token", "elsewhere", ".example.com", 3],
	]);
	expect(readXCookies(profile)).toEqual({ authToken: "token", ct0: "new" });
});
