import { describe, expect, test } from "bun:test";
import { type CatalogModel, samePullRequest, splitSelector } from "./shared";

describe("splitSelector", () => {
	const listed = (selector: string): [string, CatalogModel] => [selector, { selector, provider: "openrouter", name: selector, thinking: ["low"] }];
	const models = new Map([listed("openrouter/minimax/minimax-m3"), listed("openrouter/minimax/minimax-m3:batch")]);

	test("a colon that belongs to a listed model id is not a thinking level", () => {
		expect(splitSelector("openrouter/minimax/minimax-m3:batch", models)).toEqual({ model: "openrouter/minimax/minimax-m3:batch", level: null });
		expect(splitSelector("openrouter/minimax/minimax-m3:batch:low", models)).toEqual({
			model: "openrouter/minimax/minimax-m3:batch",
			level: "low",
		});
		expect(splitSelector("openrouter/minimax/minimax-m3:low", models)).toEqual({ model: "openrouter/minimax/minimax-m3", level: "low" });
		expect(splitSelector("cursor/grok-4.7-high", models)).toEqual({ model: "cursor/grok-4.7-high", level: null });
	});
});

describe("samePullRequest", () => {
	test("matches owner and repository in any case, as GitHub does, and the number exactly", () => {
		const pr = { owner: "Acme", repo: "WebApp", number: 12 };
		expect(samePullRequest(pr, { owner: "acme", repo: "webapp", number: 12 })).toBe(true);
		expect(samePullRequest(pr, { ...pr, number: 1 })).toBe(false);
		expect(samePullRequest(pr, { ...pr, repo: "WebApp2" })).toBe(false);
		expect(samePullRequest(pr, { ...pr, owner: "Acme2" })).toBe(false);
	});
});
