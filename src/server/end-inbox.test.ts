import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EndInbox, type EndInboxEnv } from "./end-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inboxDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-end-inbox-"));
	dirs.push(dir);
	return dir;
}

/** An inbox whose live sessions are `live`, recording what it ends. */
function inboxOf(dir: string, live: string[]) {
	const log: string[] = [];
	const env: EndInboxEnv = {
		async end(sessionId) {
			if (!live.includes(sessionId)) return false;
			log.push(`end ${sessionId}`);
			return true;
		},
	};
	return { inbox: new EndInbox(dir, env), log };
}

describe("EndInbox", () => {
	test("ends each running session it names, including a request from a tool that still says removeWorktree", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "s1.json"), JSON.stringify({ sessionId: "s1" }));
		writeFileSync(join(dir, "s2.json"), JSON.stringify({ sessionId: "s2", removeWorktree: false }));
		const { inbox, log } = inboxOf(dir, ["s1", "s2"]);
		await inbox.drain();
		expect(log.sort()).toEqual(["end s1", "end s2"]);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("a request waits until the server follows its session, and a file that is not a request is set aside", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "later.json"), JSON.stringify({ sessionId: "later" }));
		writeFileSync(join(dir, "other.json"), JSON.stringify({ sessionId: "s1" }));
		writeFileSync(join(dir, "bad.json"), "{not json");
		writeFileSync(join(dir, "s1.tmp"), JSON.stringify({ sessionId: "s1" }));
		const live: string[] = [];
		const { inbox, log } = inboxOf(dir, live);
		await inbox.drain();
		expect(log).toEqual([]);
		expect(readdirSync(dir).sort()).toEqual(["bad.json.invalid", "later.json", "other.json.invalid", "s1.tmp"]);

		live.push("later");
		await inbox.drain();
		expect(log).toEqual(["end later"]);
		expect(readdirSync(dir).sort()).toEqual(["bad.json.invalid", "other.json.invalid", "s1.tmp"]);
	});

	test("a request of version 1, or of none from a tool installed before the field, ends its session; any other version is set aside", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "s1.json"), JSON.stringify({ v: 1, sessionId: "s1" }));
		writeFileSync(join(dir, "s2.json"), JSON.stringify({ sessionId: "s2" }));
		writeFileSync(join(dir, "s3.json"), JSON.stringify({ v: 2, sessionId: "s3" }));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const { inbox, log } = inboxOf(dir, ["s1", "s2", "s3"]);
		await inbox.drain();
		expect(log.sort()).toEqual(["end s1", "end s2"]);
		expect(readdirSync(dir)).toEqual(["s3.json.invalid"]);
		logged.mockRestore();
	});
});
