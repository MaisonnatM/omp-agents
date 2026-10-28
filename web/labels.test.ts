import { describe, expect, test } from "bun:test";
import type { OmpFile } from "../src/shared/models";
import { age, commandLabel, dayLabel, fileGroups, mailTime, modelLabel, modelOrg, providerLabel, skillLabel } from "./labels";

describe("model labels", () => {
	test("a direct provider's model reads as its family and dotted version", () => {
		expect(modelLabel("anthropic/claude-opus-5-5")).toBe("Opus 5.5");
		expect(modelOrg("anthropic/claude-opus-5-5")).toBe("anthropic");
		expect(modelLabel("openai-codex/gpt-5.5")).toBe("GPT-5.5");
		expect(modelOrg("openai-codex/gpt-5.5")).toBe("openai");
	});

	test("dated and version-first Anthropic ids read like the current ones", () => {
		expect(modelLabel("anthropic/claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
		expect(modelLabel("anthropic/claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
		expect(modelLabel("openrouter/openai/gpt-4o-mini-2024-07-18")).toBe("GPT-4o Mini");
	});

	test("only one- and two-digit parts join into a version, and a zero minor version drops", () => {
		expect(modelLabel("openai/gpt-4-1106-preview")).toBe("GPT-4 1106 Preview");
		expect(modelLabel("cursor/claude-opus-5-5-1m-fast")).toBe("Opus 5.5 1M Fast");
		expect(modelLabel("anthropic/claude-sonnet-4-0")).toBe("Sonnet 4");
	});

	test("a colon suffix reads in parentheses, whether a router's tier or a thinking level", () => {
		expect(modelLabel("openrouter/openai/o3-mini:batch")).toBe("o3 Mini (batch)");
		expect(modelLabel("anthropic/claude-sonnet-5-5:high")).toBe("Sonnet 5.5 (high)");
	});

	test("a reseller's model belongs to the family's org", () => {
		expect(modelOrg("cursor/claude-opus-4-7")).toBe("anthropic");
		expect(modelOrg("cursor/composer-2")).toBe("cursor");
	});

	test("a router's org/model id names the org", () => {
		expect(modelLabel("openrouter/~anthropic/claude-opus-latest")).toBe("Opus Latest");
		expect(modelOrg("openrouter/~anthropic/claude-opus-latest")).toBe("anthropic");
		expect(modelLabel("openrouter/moonshotai/kimi-k3")).toBe("Kimi K3");
		expect(modelOrg("openrouter/z-ai/glm-5.3")).toBe("z-ai");
	});

	test("provider ids and skill names read as titles, keeping brand casing", () => {
		expect(providerLabel("openai-codex")).toBe("OpenAI Codex");
		expect(providerLabel("openrouter")).toBe("OpenRouter");
		expect(skillLabel("poteto-mode")).toBe("Poteto Mode");
		expect(skillLabel("Poteto Mode")).toBe("Poteto Mode");
	});
});

describe("day labels", () => {
	test("a time in the current year reads as its day, and one a day earlier across new year as its month and year", () => {
		const now = new Date(2026, 0, 2, 9);
		expect(dayLabel(new Date(2026, 0, 1, 23).toISOString(), now)).not.toContain("2026");
		expect(dayLabel(new Date(2025, 11, 31, 23).toISOString(), now)).toContain("2025");
	});

	test("mail reads as its time on today's date, its day earlier this year, and its full date in an earlier year", () => {
		const now = new Date(2026, 0, 2, 9);
		const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
		expect(mailTime(new Date(2026, 0, 2, 8, 5).getTime(), now)).toBe(clock.format(new Date(2026, 0, 2, 8, 5)));
		expect(mailTime(new Date(2026, 0, 1, 23).getTime(), now)).toBe(dayLabel(new Date(2026, 0, 1, 23).toISOString(), now));
		const lastYear = mailTime(new Date(2025, 11, 31, 23).getTime(), now);
		expect([lastYear.includes("2025"), lastYear.includes("31")]).toEqual([true, true]);
	});
});

describe("ages", () => {
	const now = Date.parse("2026-10-02T12:00:00Z");
	const ago = (minutes: number, compact: boolean): string => age(now - minutes * 60_000, { compact, now });
	const minutes = [0, 0.9, 1, 59, 60, 23 * 60 + 59, 24 * 60, -5];

	test("a compact age shows its largest whole unit, rounding down at each boundary", () => {
		expect(minutes.map(at => ago(at, true))).toEqual(["<1m", "<1m", "1m", "59m", "1h", "23h", "1d", "<1m"]);
	});

	test("a full age shows hours with their minutes", () => {
		expect(minutes.map(at => ago(at, false))).toEqual(["0m", "0m", "1m", "59m", "1h 0m", "23h 59m", "1d", "0m"]);
	});
});

describe("command labels", () => {
	test("absolute paths read as their last segment, and the rest stays as typed", () => {
		expect(commandLabel("/opt/homebrew/bin/node /Users/me/app/node_modules/.bin/tsc --noEmit -w")).toBe("node tsc --noEmit -w");
		expect(commandLabel("smoke-hold: /bin/zsh -l -c bun -e 'x/y'")).toBe("smoke-hold: zsh -l -c bun -e 'x/y'");
		expect(commandLabel("vite --port 5173")).toBe("vite --port 5173");
	});
});

describe("file groups", () => {
	const file = (kind: OmpFile["kind"], path: string, scope: OmpFile["scope"] = "user"): OmpFile => ({ kind, scope, path, pathDisplay: path, body: { state: "missing" } });
	const files = [
		file("skill", "/u/.omp/agent/skills/poteto-mode/SKILL.md"),
		file("context", "/repo/AGENTS.md", "project"),
		file("context", "/u/.omp/agent/AGENTS.md"),
		file("agent", "/u/.omp/agent/agents/poteto-agent.md"),
		file("skill", "/u/.omp/agent/skills/better-ui/SKILL.md"),
	];
	const paths = (query: string) => fileGroups(files, query).map(([kind, group]) => [kind, group.map(entry => entry.path)]);

	test("a blank filter lists every file by kind in the page's order, user files before project files", () => {
		expect(paths("")).toEqual([
			["context", ["/u/.omp/agent/AGENTS.md", "/repo/AGENTS.md"]],
			["agent", ["/u/.omp/agent/agents/poteto-agent.md"]],
			["skill", ["/u/.omp/agent/skills/poteto-mode/SKILL.md", "/u/.omp/agent/skills/better-ui/SKILL.md"]],
		]);
	});

	test("a filter keeps the files whose listed name holds every word in any case, a skill named by its directory, and drops the kinds left empty", () => {
		expect(paths("POTETO")).toEqual([
			["agent", ["/u/.omp/agent/agents/poteto-agent.md"]],
			["skill", ["/u/.omp/agent/skills/poteto-mode/SKILL.md"]],
		]);
		expect(paths("mode poteto")).toEqual([["skill", ["/u/.omp/agent/skills/poteto-mode/SKILL.md"]]]);
		expect(paths("skill")).toEqual([]);
	});
});
