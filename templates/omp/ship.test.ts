import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	commands(line: string): string[][];
	ghPr(words: string[], sub: "create" | "ready"): string[] | undefined;
	prSelector(args: string[]): string[];
	selectorOwner(selector: string[]): string | undefined;
	otherOwner(owner: string | undefined, repo: string | undefined): boolean;
	publishBlocker(body: string, files: string[]): string | undefined;
	CHECKBOX: string;
	BROWSER_PROOF: string;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { commands, ghPr, prSelector, selectorOwner, otherOwner, publishBlocker, CHECKBOX, BROWSER_PROOF } = extension;

/** The `gh pr view` selector of each `gh pr ready` a bash line runs. */
function readySelectors(line: string): string[][] {
	return commands(line).flatMap(words => {
		const ready = ghPr(words, "ready");
		return ready ? [prSelector(ready)] : [];
	});
}

describe("ship command parsing", () => {
	test.each([
		["gh pr ready 23 >/dev/null", [["23"]]],
		["gh pr ready 314 2>&1", [["314"]]],
		["gh pr ready 5 -R a/b", [["5", "--repo", "a/b"]]],
		['rg "gh pr ready" f', []],
		["cd x && gh pr ready 4", [["4"]]],
		["gh pr ready 6 > out.txt 2> err.txt", [["6"]]],
		["gh pr ready --repo=a/b feature-branch &>/dev/null", [["feature-branch", "--repo", "a/b"]]],
		["GH_DEBUG=1 gh pr ready 8 | cat; echo 'gh pr ready 9'", [["8"]]],
		["(cd x; gh pr ready)", [[]]],
	])("%s", (line, selectors) => {
		expect(readySelectors(line)).toEqual(selectors);
	});

	test("separators inside quotes stay in their word", () => {
		expect(commands(`gh pr create --draft --title "a; b && c | d" --body 'x & y'`)).toEqual([
			["gh", "pr", "create", "--draft", "--title", "a; b && c | d", "--body", "x & y"],
		]);
	});

	test.each([
		[["5", "--repo", "a/b"], "a"],
		[["5", "--repo", "github.com/a/b"], "a"],
		[["https://github.com/dustinspecker/awesome-eslint/pull/12"], "dustinspecker"],
		[["12"], undefined],
	])("the owner of %j", (selector, owner) => {
		expect(selectorOwner(selector)).toBe(owner);
	});

	test.each([
		["dustinspecker", "maxence/omp-agents", true],
		["Maxence", "maxence/omp-agents", false],
		["dustinspecker", undefined, false],
		[undefined, "maxence/omp-agents", false],
	])("%s against %s differs: %s", (owner, repo, differs) => {
		expect(otherOwner(owner, repo)).toBe(differs);
	});
});

describe("publish gate", () => {
	const reviewed = `## Checks\n${CHECKBOX}`;

	test("a reviewed PR outside the console UI goes live", () => {
		expect(publishBlocker(reviewed, ["yampa/api.py", "front/e2e/a.spec.ts"])).toBeUndefined();
	});

	test("an unreviewed PR is blocked on the review", () => {
		expect(publishBlocker("", ["README.md"])).toContain(CHECKBOX);
	});

	test.each([["front/components/button.tsx"], ["front/app/routes/agents.tsx"]])("a reviewed PR changing %s needs browser proof", file => {
		const reason = publishBlocker(reviewed, [file]);
		expect(reason).toContain(BROWSER_PROOF);
		expect(reason).toContain("verify-yampa");
		expect(reason).not.toContain(CHECKBOX);
	});

	test("browser proof unblocks a reviewed UI change", () => {
		expect(publishBlocker(`${reviewed}\n${BROWSER_PROOF}`, ["front/app/root.tsx"])).toBeUndefined();
	});

	test("an unreviewed UI change without proof names both", () => {
		const reason = publishBlocker("", ["front/components/x.tsx"]);
		expect(reason).toContain(CHECKBOX);
		expect(reason).toContain(BROWSER_PROOF);
	});
});
