import { describe, expect, test } from "bun:test";
import type { ServerMsg } from "../shared/protocol";
import { UsagePoll } from "./usage-poll";

const REPORT: Extract<ServerMsg, { t: "usage" }> = { t: "usage", plans: [], error: null };

function harness() {
	const fake = { runs: 0, checks: 0, failCheck: false, log: [] as string[] };
	const poll = new UsagePoll({
		async refresh() {
			fake.runs++;
			fake.log.push(`run ${fake.runs}`);
			return { ...REPORT, plans: [] };
		},
		async checkNotices() {
			fake.checks++;
			fake.log.push(`check after ${fake.runs}`);
			if (fake.failCheck) throw new Error("notices.json is locked");
		},
	});
	return { fake, poll };
}

describe("UsagePoll", () => {
	test("a page that opens after a continue's read alone still checks the plan notices", async () => {
		const { fake, poll } = harness();
		await poll.tick(true);
		await poll.tick(false);
		await poll.fresh();
		await poll.opened();
		expect(fake.log).toEqual(["run 1", "check after 1", "run 2", "run 3", "check after 3"]);
		await poll.opened();
		expect([fake.runs, fake.checks]).toEqual([3, 2]);
	});

	test("a notice check that fails is tried again when the next page opens", async () => {
		const { fake, poll } = harness();
		fake.failCheck = true;
		await expect(poll.tick(true)).rejects.toThrow("notices.json is locked");
		fake.failCheck = false;
		await poll.opened();
		expect([fake.runs, fake.checks]).toEqual([2, 2]);
	});

	test("a continue's read waits out a run under way and reads again", async () => {
		const { fake, poll } = harness();
		const ticking = poll.tick(true);
		expect(await poll.fresh()).toEqual(REPORT);
		await ticking;
		expect([fake.runs, fake.checks, poll.report]).toEqual([2, 1, REPORT]);
	});
});
