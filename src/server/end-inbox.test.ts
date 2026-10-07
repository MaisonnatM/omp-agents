import { afterEach, describe, expect, test } from "bun:test";
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

/** An inbox whose live sessions are `live`, recording what it ends and removes, in order. */
function inboxOf(dir: string, live: string[]) {
	const log: string[] = [];
	const env: EndInboxEnv = {
		session: sessionId =>
			live.includes(sessionId)
				? {
						workDir: `/work/${sessionId}`,
						end: async () => {
							log.push(`end ${sessionId}`);
						},
					}
				: null,
		removeWorktree: async workDir => {
			log.push(`remove ${workDir}`);
			return null;
		},
	};
	return { inbox: new EndInbox(dir, env), log };
}

describe("EndInbox", () => {
	test("ends a running session, and removes its worktree only after it ended and only when asked", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "s1.json"), JSON.stringify({ sessionId: "s1", removeWorktree: true }));
		writeFileSync(join(dir, "s2.json"), JSON.stringify({ sessionId: "s2", removeWorktree: false }));
		const { inbox, log } = inboxOf(dir, ["s1", "s2"]);
		await inbox.drain();
		expect(log.sort()).toEqual(["end s1", "end s2", "remove /work/s1"]);
		expect(log.indexOf("end s1")).toBeLessThan(log.indexOf("remove /work/s1"));
		expect(readdirSync(dir)).toEqual([]);
	});

	test("a request waits until the server follows its session, and a file that is not a request is set aside", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "later.json"), JSON.stringify({ sessionId: "later", removeWorktree: false }));
		writeFileSync(join(dir, "other.json"), JSON.stringify({ sessionId: "s1", removeWorktree: false }));
		writeFileSync(join(dir, "bad.json"), "{not json");
		writeFileSync(join(dir, "s1.tmp"), JSON.stringify({ sessionId: "s1", removeWorktree: false }));
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
});
