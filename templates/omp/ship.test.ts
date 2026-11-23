import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SHIP_STAGES, SHIP_WORK } from "../../src/shared/sessions";
import { commands } from "./agent/extensions/shell/commands";

type Review = { label: string; box: string; pathsFile: string; withoutPaths: boolean };
type Reviews = Record<string, { needed: boolean; done: boolean }>;
// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
type FixWork = "fix_ci" | "fix_comments";
type Fixes = Partial<Record<FixWork, { rounds: number; counts: number[] }>>;
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
	renderLines(state: { stage: string; issue?: string; updatedAt: string }): string[];
	STAGES: readonly string[];
	LIVE_WORK: readonly string[];
	FIX_BUDGET: number;
	startFix(fixes: Fixes | undefined, work: FixWork, count: number | undefined): { fixes: Fixes; round: number } | { round: number; refusal: string };
	settleFixes(fixes: Fixes | undefined, status: object | undefined): Fixes | undefined;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { ghPr, prSelector, selectorOwner, otherOwner, publishBlocker, reviewsOf, reviewNeeded, authDiagnosis, REVIEWS, PROOF_BOX, renderLines } = extension;
const THERMONUCLEAR = REVIEWS.thermonuclear.box;
const INTERFACE = REVIEWS.interface_review.box;

describe("the ship widget", () => {
	test("the dashboard reads the same stages and live work the extension records", () => {
		expect([...extension.STAGES]).toEqual([...SHIP_STAGES]);
		expect([...extension.LIVE_WORK]).toEqual([...SHIP_WORK]);
	});

	test("plans after the ticket and before implementing, with the PR stages on the second row", () => {
		expect(renderLines({ stage: "plan", issue: "ENG-1", updatedAt: "" })).toEqual([
			"ship ENG-1",
			"✓ Ticket  ▶ Plan  ○ Implement  ○ Draft PR",
			"○ Interface review  ○ Thermonuclear  ○ Ready gate  ○ Live for review  ○ Merged",
		]);
	});

	test("a run past the ticket step without an issue says it has no ticket, not that one is still coming", () => {
		expect(renderLines({ stage: "ticket", updatedAt: "" })[0]).toBe("ship (no ticket yet)");
		expect(renderLines({ stage: "plan", updatedAt: "" })[0]).toBe("ship (no ticket)");
	});
});

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
		["gh pr -R a/b ready 5", [["5", "--repo", "a/b"]]],
		["gh pr --repo=a/b ready 5 -R c/d", [["5", "--repo", "c/d"]]],
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

	test("an unreviewed PR that needs no review is still blocked on the box when it changes the interface", () => {
		const reason = blocker(`${INTERFACE}\n${PROOF_BOX}`, ["web/app.tsx"], { ...noThermonuclear, ...ui });
		expect(reason).toContain(PROOF_BOX);
		expect(reason).not.toContain(THERMONUCLEAR);
	});

	const interfaceReviewed = `${reviewed}\n${INTERFACE}`;

	test.each([PROOF_BOX, `  ${PROOF_BOX} (UI changes: run verify-yampa, attach screenshot)`])("a reviewed PR changing the interface with %j is blocked on the box", box => {
		const reason = blocker(`${interfaceReviewed}\n${box}`, ["web/app.tsx"], ui);
		expect(reason).toContain(PROOF_BOX);
		expect(reason).toContain(".omp/ui-paths");
		expect(reason).not.toContain(THERMONUCLEAR);
	});

	test("an unchecked box blocks when GitHub lists fewer changed files than the PR has", () => {
		expect(publishBlocker(`${interfaceReviewed}\n${PROOF_BOX}`, reviewsOf(interfaceReviewed, ["README.md"], 2, paths => ui[paths as keyof typeof ui]))).toContain(PROOF_BOX);
	});

	test.each([
		["no ui paths", ["web/app.tsx"], {}],
		["no changed file the ui paths match", ["README.md"], ui],
	] as const)("a reviewed PR with an unchecked box and %s goes live", (_, files, checkout) => {
		expect(blocker(`${reviewed}\n${PROOF_BOX}`, [...files], checkout)).toBeUndefined();
	});

	test.each(["- [x] Browser proof", "- [X] Browser proof (UI changes)"])("a reviewed PR changing the interface with %j goes live", box => {
		expect(blocker(`${interfaceReviewed}\n${box}`, ["web/app.tsx"], ui)).toBeUndefined();
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

describe("fix rounds", () => {
	const { startFix, settleFixes, FIX_BUDGET } = extension;
	/** Starts a round of `work` for each count, carrying the rounds a started one returns; the outcome of each. */
	function rounds(counts: (number | undefined)[], work: FixWork = "fix_ci", fixes?: Fixes) {
		return counts.map(count => {
			const next = startFix(fixes, work, count);
			if ("fixes" in next) fixes = next.fixes;
			return next;
		});
	}
	const refused = (outcomes: ReturnType<typeof rounds>) => outcomes.map(outcome => "refusal" in outcome);
	/** GitHub's status of an open PR under review whose checks read `checks`, with `threads` unresolved review threads. */
	const status = (checks: string, threads = 0) => ({ state: "OPEN", draft: false, conflicts: false, behind: false, unresolvedThreads: threads, changesRequested: false, moreThreads: false, approved: false, checks, reviews: {} });

	test(`the round after ${FIX_BUDGET} is refused and sends the agent to the user`, () => {
		const outcomes = rounds(Array(FIX_BUDGET + 1).fill(undefined));
		expect(refused(outcomes)).toEqual([false, false, false, false, false, true]);
		expect(outcomes.at(-1)).toMatchObject({ round: 6, refusal: expect.stringContaining("ask them with `ask`") });
	});

	test("a count that did not shrink for two rounds in a row stalls the third", () => {
		expect(refused(rounds([3, 3, 4], "fix_comments"))).toEqual([false, false, true]);
		expect(rounds([3, 3, 3]).at(-1)).toMatchObject({ refusal: expect.stringContaining("3 → 3 → 3") });
		expect(refused(rounds([4, 4, 3, 3, 3]))).toEqual([false, false, false, false, true]);
		expect(refused(rounds([5, 4, 3]))).toEqual([false, false, false]);
		expect(refused(rounds([3, undefined, 3, undefined]))).toEqual([false, false, false, false]);
	});

	test("a fix GitHub shows done starts over, and one it does not keeps its rounds", () => {
		const spent: Fixes = { fix_ci: { rounds: FIX_BUDGET, counts: [2, 2] }, fix_comments: { rounds: 2, counts: [1] } };
		expect(settleFixes(spent, status("pass", 1))).toEqual({ fix_comments: spent.fix_comments });
		expect(settleFixes(spent, status("pending", 1))).toEqual(spent);
		expect(settleFixes(spent, status("pass"))).toBeUndefined();
		expect(rounds([2], "fix_ci", settleFixes(spent, status("pass", 1)))).toEqual([{ round: 1, fixes: { ...settleFixes(spent, status("pass", 1)), fix_ci: { rounds: 1, counts: [2] } } }]);
	});
});
