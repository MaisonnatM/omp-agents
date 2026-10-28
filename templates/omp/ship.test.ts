import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { commands } from "./agent/extensions/shell/commands";

type Review = { label: string; box: string; pathsFile: string; withoutPaths: boolean };
type Reviews = Record<string, { needed: boolean; done: boolean }>;
// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	ghPr(words: string[], sub: "create" | "ready"): string[] | undefined;
	prSelector(args: string[]): string[];
	selectorOwner(selector: string[]): string | undefined;
	otherOwner(owner: string | undefined, repo: string | undefined): boolean;
	publishBlocker(body: string, reviews: Reviews): string | undefined;
	reviewsOf(body: string, files: string[], changedFiles: number, read: (pathsFile: string) => string | undefined): Reviews;
	reviewNeeded(review: Review, paths: string | undefined, files: string[], changedFiles: number): boolean;
	authDiagnosis(credentials: { host: string; state: string; active: boolean; login: string; tokenSource: string }[], dotenvFiles: Record<string, string>): string | undefined;
	REVIEWS: Record<string, Review>;
	PROOF_BOX: string;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { ghPr, prSelector, selectorOwner, otherOwner, publishBlocker, reviewsOf, reviewNeeded, authDiagnosis, REVIEWS, PROOF_BOX } = extension;
const THERMONUCLEAR = REVIEWS.thermonuclear.box;
const INTERFACE = REVIEWS.interface_review.box;

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
	const reviewed = `## Checks\n${THERMONUCLEAR}`;
	/** Why a PR with this body changing `files` may not go live, from a checkout holding the paths files `checkout` maps by name. */
	const blocker = (body: string, files: string[], checkout: Record<string, string> = {}) =>
		publishBlocker(body, reviewsOf(body, files, files.length, paths => checkout[paths]));
	const noThermonuclear = { ".omp/review-paths": "src/shared/**\n" };
	const ui = { ".omp/ui-paths": "web/**/*.tsx\n" };

	test("a reviewed PR without a proof box goes live", () => {
		expect(blocker(reviewed, ["README.md"])).toBeUndefined();
	});

	test("an unreviewed PR is blocked on the review", () => {
		expect(blocker(PROOF_BOX, ["README.md"])).toContain(THERMONUCLEAR);
	});

	test("an unreviewed PR that needs no review goes live", () => {
		expect(blocker("## Summary", ["README.md"], noThermonuclear)).toBeUndefined();
	});

	test("an unreviewed PR that needs no review is still blocked on the box", () => {
		const reason = blocker(PROOF_BOX, ["README.md"], noThermonuclear);
		expect(reason).toContain(PROOF_BOX);
		expect(reason).not.toContain(THERMONUCLEAR);
	});

	test.each([PROOF_BOX, `  ${PROOF_BOX} (UI changes: run verify-yampa, attach screenshot)`])("a reviewed PR with %j is blocked on the box", box => {
		const reason = blocker(`${reviewed}\n${box}`, ["README.md"]);
		expect(reason).toContain(PROOF_BOX);
		expect(reason).not.toContain(THERMONUCLEAR);
	});

	test.each(["- [x] Browser proof", "- [X] Browser proof (UI changes)"])("a reviewed PR with %j goes live", box => {
		expect(blocker(`${reviewed}\n${box}`, ["README.md"])).toBeUndefined();
	});

	test("a PR changing a file the ui paths match is blocked on the interface box, before the thermonuclear one", () => {
		expect(blocker("## Summary", ["web/app.tsx"], ui)).toBe(
			"Blocked: the PR is not live until the Interface review stage is done. Run it, apply and push its fixes, then add `- [x] Interface review` to the PR body.",
		);
		expect(blocker(reviewed, ["web/app.tsx"], ui)).toContain(INTERFACE);
	});

	test("a PR with both boxes goes live", () => {
		expect(blocker(`${reviewed}\n${INTERFACE}`, ["web/app.tsx"], ui)).toBeUndefined();
	});

	test("a repository without ui paths is never blocked on the interface box", () => {
		expect(blocker(reviewed, ["web/app.tsx"])).toBeUndefined();
	});
});

describe("review paths", () => {
	const paths = "# Shared contracts\nsrc/shared/protocol.ts\n\n  templates/omp/agent/extensions/**  # the kit's gates\n";
	const thermonuclear = REVIEWS.thermonuclear;

	test("a repository without review paths reviews every change", () => {
		expect(reviewNeeded(thermonuclear, undefined, ["README.md"], 1)).toBe(true);
	});

	test("a change that matches no glob needs no review", () => {
		expect(reviewNeeded(thermonuclear, paths, ["README.md", "src/shared/protocol.test.ts"], 2)).toBe(false);
	});

	test.each(["src/shared/protocol.ts", "templates/omp/agent/extensions/github/access.ts"])("a change to %s needs the review", file => {
		expect(reviewNeeded(thermonuclear, paths, ["README.md", file], 2)).toBe(true);
	});

	test("comments and blank lines match nothing", () => {
		expect(reviewNeeded(thermonuclear, "# src/shared/protocol.ts\n\n", ["src/shared/protocol.ts"], 1)).toBe(false);
	});

	test("a change list GitHub cut short needs the review", () => {
		expect(reviewNeeded(thermonuclear, paths, ["README.md"], 101)).toBe(true);
	});
});

describe("ui paths", () => {
	const paths = "web/**/*.tsx\nweb/**/*.css\n";
	const review = REVIEWS.interface_review;

	test.each([[["web/app.tsx"], 1], [["README.md"], 101]])("a repository without ui paths never needs the interface review (%j of %d)", (files, changedFiles) => {
		expect(reviewNeeded(review, undefined, files, changedFiles)).toBe(false);
	});

	test.each([["web/components/row.tsx", true], ["web/styles/app.css", true], ["src/server/wire.ts", false]])("a change to %s needs the interface review: %s", (file, needed) => {
		expect(reviewNeeded(review, paths, [file], 1)).toBe(needed);
	});

	test("with ui paths, a change list GitHub cut short needs the interface review", () => {
		expect(reviewNeeded(review, paths, ["README.md"], 101)).toBe(true);
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
