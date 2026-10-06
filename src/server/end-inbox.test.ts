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

/** An inbox whose live sessions are `live`, recording what it ends, removes, and reports, in order. */
function inboxOf(dir: string, live: string[], removal: (cwd: string) => Promise<string | null> = async () => null) {
	const log: string[] = [];
	const env: EndInboxEnv = {
		session: sessionId =>
			live.includes(sessionId)
				? {
						cwd: `/work/${sessionId}`,
						end: async () => {
							log.push(`end ${sessionId}`);
						},
					}
				: null,
		removeWorktree: async cwd => {
			log.push(`remove ${cwd}`);
			return removal(cwd);
		},
		report: (sessionId, text, body) => log.push(`report ${sessionId}: ${text}: ${body}`),
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

	test("a worktree that stays leaves the user a todo naming why", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "s1.json"), JSON.stringify({ sessionId: "s1", removeWorktree: true }));
		const { inbox, log } = inboxOf(dir, ["s1"], async () => "Tracked modifications or untracked files must be preserved before removal.");
		await inbox.drain();
		expect(log.at(-1)).toBe(
			"report s1: Remove the worktree /work/s1: The session asked to end and to remove its worktree, which stayed: Tracked modifications or untracked files must be preserved before removal.",
		);
	});
});
