import { describe, expect, test } from "bun:test";
import { endSession, type RemoveCheckout } from "./session-end";

/** A session in `/work/s1` whose end and worktree removal are logged in order. */
function harness(end: () => Promise<void>) {
	const log: string[] = [];
	const removeCheckout: RemoveCheckout = async dir => {
		log.push(`remove ${dir}`);
		return null;
	};
	const session = {
		sessionId: "s1",
		workDir: "/work/s1",
		async end() {
			await end();
			log.push("end");
		},
	};
	return { log, run: () => endSession(session, removeCheckout) };
}

describe("endSession", () => {
	test("removes the worktree once the session has ended", async () => {
		const { log, run } = harness(async () => {});
		await run();
		expect(log).toEqual(["end", "remove /work/s1"]);
	});

	test("keeps the worktree of a session that could not be ended", async () => {
		const { log, run } = harness(async () => {
			throw new Error("gone");
		});
		await run();
		expect(log).toEqual([]);
	});
});
