import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SignedOutReport, SignInInbox } from "./sign-in-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SignInInbox", () => {
	test("hands each report of version 1 on as its account and time, and sets aside any other version or shape", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-sign-in-inbox-"));
		dirs.push(dir);
		writeFileSync(join(dir, "a.json"), JSON.stringify({ v: 1, server: "google-calendar", at: 5 }));
		writeFileSync(join(dir, "v2.json"), JSON.stringify({ v: 2, server: "gmail", at: 5 }));
		writeFileSync(join(dir, "none.json"), JSON.stringify({ server: "gmail", at: 5 }));
		writeFileSync(join(dir, "nameless.json"), JSON.stringify({ v: 1, server: "", at: 5 }));
		writeFileSync(join(dir, "undated.json"), JSON.stringify({ v: 1, server: "gmail" }));
		const reports: SignedOutReport[] = [];
		await new SignInInbox(dir, { report: async report => void reports.push(report) }).drain();
		expect(reports).toEqual([{ account: "google-calendar", at: 5 }]);
		expect(readdirSync(dir).sort()).toEqual(["nameless.json.invalid", "none.json.invalid", "undated.json.invalid", "v2.json.invalid"]);
	});
});
