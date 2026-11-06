import { expect, test } from "bun:test";
import type { UsageReport } from "./module-types/models";
import { createRawUsageReader } from "./usage";

const TTL = 5 * 60_000;

test("holds the last raw usage snapshot when a later read is stripped or fails", async () => {
	let now = 0;
	let calls = 0;
	let closed = 0;
	let answer: UsageReport[] | null = [{ provider: "anthropic", limits: [], raw: { spend: { enabled: true } } }];
	let fail = false;
	const read = createRawUsageReader(async () => ({
		usage: {
			reports: async () => {
				calls += 1;
				if (fail) throw new Error("down");
				return answer;
			},
		},
		close() {
			closed += 1;
		},
	}), () => now);
	const fresh = await read();

	expect(fresh?.[0]?.raw).toBeTruthy();
	now = TTL - 1;
	expect(await read()).toBe(fresh);
	expect(calls).toBe(1);

	now = TTL;
	answer = [{ provider: "anthropic", limits: [] }];
	expect(await read()).toBe(fresh);
	fail = true;
	expect(await read()).toBe(fresh);
	expect(calls).toBe(3);
	expect(closed).toBe(3);
});
