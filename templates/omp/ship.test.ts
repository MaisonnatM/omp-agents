import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	commands(line: string): string[][];
	ghPr(words: string[], sub: "create" | "ready"): string[] | undefined;
	prSelector(args: string[]): string[];
	selectorOwner(selector: string[]): string | undefined;
	otherOwner(owner: string | undefined, repo: string | undefined): boolean;
	publishBlocker(body: string): string | undefined;
	authDiagnosis(credentials: { host: string; state: string; active: boolean; login: string; tokenSource: string }[], dotenvFiles: Record<string, string>): string | undefined;
	CHECKBOX: string;
	PROOF_BOX: string;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { commands, ghPr, prSelector, selectorOwner, otherOwner, publishBlocker, authDiagnosis, CHECKBOX, PROOF_BOX } = extension;

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
		["env -u GITHUB_TOKEN gh pr ready 51", [["51"]]],
		["A=1 env -i --unset GH_TOKEN -C /tmp B=2 gh pr ready 6", [["6"]]],
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

	test("a reviewed PR without a proof box goes live", () => {
		expect(publishBlocker(reviewed)).toBeUndefined();
	});

	test("an unreviewed PR is blocked on the review", () => {
		expect(publishBlocker(PROOF_BOX)).toContain(CHECKBOX);
	});

	test.each([PROOF_BOX, `  ${PROOF_BOX} (UI changes: run verify-yampa, attach screenshot)`])("a reviewed PR with %j is blocked on the box", box => {
		const reason = publishBlocker(`${reviewed}\n${box}`);
		expect(reason).toContain(PROOF_BOX);
		expect(reason).not.toContain(CHECKBOX);
	});

	test.each(["- [x] Browser proof", "- [X] Browser proof (UI changes)"])("a reviewed PR with %j goes live", box => {
		expect(publishBlocker(`${reviewed}\n${box}`)).toBeUndefined();
	});
});

describe("GitHub auth diagnosis", () => {
	const keyring = { host: "github.com", state: "success", active: false, login: "octocat", tokenSource: "keyring" };
	const token = { host: "github.com", state: "error", active: true, login: "", tokenSource: "GITHUB_TOKEN" };

	test.each(["success", "timeout"])("an active credential in state %s is not diagnosed as rejected", state => {
		expect(authDiagnosis([{ ...keyring, active: true, state }], {})).toBeUndefined();
	});

	test("a rejected keyring login asks for a new login", () => {
		expect(authDiagnosis([{ ...keyring, active: true, state: "error" }], {})).toContain("gh auth login -h github.com");
	});

	test("a rejected token with no working login to fall back to needs a replacement or a new login", () => {
		const diagnosis = authDiagnosis([token], { GITHUB_TOKEN: "/repo/.env" });
		expect(diagnosis).toContain("/repo/.env");
		expect(diagnosis).toContain("gh auth login");
	});
});
