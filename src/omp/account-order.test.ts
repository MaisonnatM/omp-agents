import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orderableAccounts } from "../shared/providers";
import { orderPolicies, rankAccounts, readAccountPolicies, writeAccountOrder } from "./account-order";
import { agentDir } from "./config";

const work = { email: "maxence@maisonnat.com" };
const home = { email: "maisonnatmax@gmail.com" };
const team = { email: "team@example.com", accountId: "acct-team", orgId: "org-1" };

describe("rankAccounts", () => {
	const accounts = [
		{ id: 1, identity: home },
		{ id: 2, identity: null },
		{ id: 3, identity: work },
		{ id: 4, identity: team },
	];
	const rank = (policies: unknown[]): number[] => rankAccounts(accounts, "anthropic", policies, account => account.identity).map(account => account.id);

	test("the highest priority comes first, and an account no policy names, or an API key, ranks at 0 in stored order", () => {
		expect(rank([{ provider: "anthropic", account: work, priority: 10, reclaimAbovePct: 5 }])).toEqual([3, 1, 2, 4]);
		expect(rank([])).toEqual([1, 2, 3, 4]);
	});

	test("a policy matches as omp does: every field its selector sets, and only the provider it names", () => {
		expect(rank([{ provider: "anthropic", account: { accountId: "acct-team" }, priority: 3 }])).toEqual([4, 1, 2, 3]);
		expect(rank([{ provider: "anthropic", account: { accountId: "acct-team", orgId: "org-2" }, priority: 3 }])).toEqual([1, 2, 3, 4]);
		expect(rank([{ provider: "openai-codex", account: work, priority: 10 }])).toEqual([1, 2, 3, 4]);
	});

	test("a negative priority ranks below the accounts no policy names, and a malformed entry is passed over", () => {
		expect(rank([{ provider: "anthropic", account: home, priority: -1 }, "not a policy", { provider: "anthropic" }])).toEqual([2, 3, 4, 1]);
	});
});

describe("orderPolicies", () => {
	test("reuses each account's own policy, keeping its selector and other fields, and gives descending priorities", () => {
		const codex = { provider: "openai-codex", account: { email: "x@example.com" }, priority: 4 };
		const policies = [codex, { provider: "anthropic", account: work, priority: 10, reclaimAbovePct: 5 }, { provider: "anthropic", account: { accountId: "acct-team" }, reservePct: 20 }];
		expect(orderPolicies(policies, "anthropic", [team, home, work])).toEqual([
			codex,
			{ provider: "anthropic", account: work, priority: 1, reclaimAbovePct: 5 },
			{ provider: "anthropic", account: { accountId: "acct-team" }, reservePct: 20, priority: 3 },
			{ provider: "anthropic", account: home, priority: 2 },
		]);
	});

	test("a policy that matches no account, a malformed entry, and the input stay as they are", () => {
		const stale = { provider: "anthropic", account: { email: "gone@example.com" }, priority: 7 };
		const policies = [stale, "not a policy"];
		expect(orderPolicies(policies, "anthropic", [home, work])).toEqual([stale, "not a policy", { provider: "anthropic", account: home, priority: 2 }, { provider: "anthropic", account: work, priority: 1 }]);
		expect(policies).toEqual([stale, "not a policy"]);
	});
});

describe("orderableAccounts", () => {
	test("keeps the accounts whose email no other shares, in order", () => {
		const accounts = [
			{ id: 1, email: "a@example.com" },
			{ id: 2, email: null },
			{ id: 3, email: "shared@example.com" },
			{ id: 4, email: "b@example.com" },
			{ id: 5, email: "shared@example.com" },
		];
		expect(orderableAccounts(accounts).map(account => account.id)).toEqual([1, 4]);
	});
});

describe("writeAccountOrder", () => {
	test("rewrites the user's policies in config.yml and leaves every other setting", async () => {
		const config = join(agentDir, "config.yml");
		writeFileSync(
			config,
			[
				"compaction:",
				"  enabled: false",
				"auth:",
				"  accountPolicies:",
				"    - provider: anthropic",
				"      account:",
				"        email: maxence@maisonnat.com",
				"      priority: 10",
				"      reclaimAbovePct: 5",
				"",
			].join("\n"),
		);
		try {
			await writeAccountOrder("anthropic", [home, work]);
			expect(await readAccountPolicies()).toEqual([
				{ provider: "anthropic", account: work, priority: 1, reclaimAbovePct: 5 },
				{ provider: "anthropic", account: home, priority: 2 },
			]);
			expect(await Bun.file(config).text()).toContain("enabled: false");
		} finally {
			rmSync(config, { force: true });
		}
	});
});
