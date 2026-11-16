import { describe, expect, test } from "bun:test";
import type { PullRequestSummary, RepoPullRequests } from "../src/shared/github";
import type { AgentOn } from "../src/shared/moves";
import { withToggled } from "./list-filter";
import { DEFAULT_ORDER, foldedByDefault, sectionTitles } from "./pull-requests-model";
import {
	atLeastOneSection,
	authorOptions,
	cardFoldKey,
	DEFAULT_DISPLAY,
	decodeDisplay,
	decodeFilter,
	encodeDisplay,
	encodeFilter,
	EVERY_SECTION,
	filteredList,
	groupedList,
	groupFoldKey,
	keepsPullRequest,
	type ListGroup,
	matchesQuery,
	NO_FILTER,
	repoOptions,
	shownPullRequests,
	VIEW_PRESETS,
	viewOf,
} from "./pull-requests-filter";

const pr = (number: number, fields: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
	owner: "acme",
	repo: "webapp",
	number,
	title: `PR ${number}`,
	author: { login: "me", avatarUrl: null },
	reviewers: [],
	role: "author",
	state: "open",
	review: "review-required",
	checks: "passing",
	conflicts: false,
	additions: 0,
	deletions: 0,
	head: `me/branch-${number}`,
	base: "main",
	stackedOn: null,
	behind: false,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	createdAt: 0,
	updatedAt: number,
	...fields,
});

const teammate = { login: "teammate", avatarUrl: null };

const noAgent: AgentOn = () => null;

const repo = (name: string, pullRequests: PullRequestSummary[]): RepoPullRequests => ({ owner: "acme", repo: name, cwds: [`/code/${name}`], pullRequests });

const broken: RepoPullRequests = { owner: "acme", repo: "broken", cwds: [], error: "GitHub did not answer" };

const repos = [repo("webapp", [pr(1), pr(2, { review: "changes-requested" })]), repo("api", [pr(3, { repo: "api", review: "changes-requested", author: teammate, role: "reviewer" }), pr(4, { repo: "api", review: "changes-requested" })])];

const unfiltered = filteredList(repos, NO_FILTER, "", DEFAULT_ORDER, noAgent, false, 0);

const names = (prs: readonly PullRequestSummary[]): string[] => prs.map(({ repo, number }) => `${repo}#${number}`);

describe("shown sections", () => {
	test("a tab is active only while the shown sections are exactly its preset", () => {
		expect(viewOf(EVERY_SECTION)).toBe("all");
		expect(viewOf(new Set(["Approved"]))).toBe("approved");
		expect(viewOf(withToggled(EVERY_SECTION, "Recently merged"))).toBe("open");
		expect(viewOf(new Set(["Your move", "Approved"]))).toBeNull();
	});

	test("the last shown section cannot be switched off", () => {
		const one = VIEW_PRESETS.merged.sections;
		expect(atLeastOneSection(withToggled(one, "Recently merged"), one)).toBe(one);
	});

	test("what is stored comes back, and a missing, unreadable, or empty value keeps everything", () => {
		const picked = { ...NO_FILTER, sections: new Set(["Drafts", "Your move"] as const), repos: new Set(["acme/api"]), authors: new Set(["teammate"]), created: 7 as const, updated: null };
		expect(decodeFilter(encodeFilter(picked))).toEqual(picked);
		for (const raw of [null, "{", "[]", '{"sections":["Gone"]}']) expect(decodeFilter(raw)).toEqual(NO_FILTER);
		expect(decodeFilter('{"sections":["Gone","Drafts"],"created":5}')).toEqual({ ...NO_FILTER, sections: new Set(["Drafts"]) });
	});

	test("the stored display round-trips, and a missing or unknown grouping falls back to grouping by repository", () => {
		const picked = { grouping: "author", empty: true } as const;
		expect(decodeDisplay(encodeDisplay(picked))).toEqual(picked);
		for (const raw of [null, "{", '{"grouping":"board"}']) expect(decodeDisplay(raw)).toEqual(DEFAULT_DISPLAY);
		expect(decodeDisplay('{"grouping":"section","empty":"yes"}')).toEqual({ grouping: "section", empty: false });
	});
});

describe("filtering and searching pull requests", () => {
	const day = 86_400_000;
	const now = 100 * day;

	test("a date range keeps what was created or updated within it, its first moment included", () => {
		const week = { ...NO_FILTER, created: 7 as const };
		expect(keepsPullRequest(pr(1, { createdAt: now - 7 * day }), week, "", now)).toBe(true);
		expect(keepsPullRequest(pr(1, { createdAt: now - 7 * day - 1 }), week, "", now)).toBe(false);
		expect(keepsPullRequest(pr(1, { updatedAt: now - 2 * day }), { ...NO_FILTER, updated: 1 }, "", now)).toBe(false);
		expect(keepsPullRequest(pr(1, { author: teammate }), { ...NO_FILTER, authors: new Set(["me"]) }, "", now)).toBe(false);
	});

	test("every word of a search must match the title, number, branch, author, or repository, in any case", () => {
		const one = pr(42, { title: "Fix login redirect", head: "me/oauth" });
		expect(matchesQuery(one, "  LOGIN #42 ")).toBe(true);
		expect(matchesQuery(one, "oauth acme/webapp")).toBe(true);
		expect(matchesQuery(one, "login signup")).toBe(false);
	});

	test("a filter drops a repository it leaves empty, unless Show empty sections keeps it, and an unreadable repository stays", () => {
		const all = [...repos, broken];
		const onlyTeammate = { ...NO_FILTER, authors: new Set(["teammate"]) };
		expect(filteredList(all, NO_FILTER, "", DEFAULT_ORDER, noAgent, false, 0).map(({ repo }) => repo.repo)).toEqual(["webapp", "api", "broken"]);
		expect(filteredList(all, onlyTeammate, "", DEFAULT_ORDER, noAgent, false, 0).map(({ repo }) => repo.repo)).toEqual(["api", "broken"]);
		expect(filteredList(all, NO_FILTER, "PR 3", DEFAULT_ORDER, noAgent, false, 0).map(({ repo }) => repo.repo)).toEqual(["api", "broken"]);
		const kept = filteredList(all, onlyTeammate, "", DEFAULT_ORDER, noAgent, true, 0);
		expect(kept.map(({ repo }) => repo.repo)).toEqual(["webapp", "api", "broken"]);
		expect(kept[0]!.sections.map(({ title, rows }) => [title, rows.length])).toEqual(sectionTitles(DEFAULT_ORDER).map(title => [title, 0]));
	});

	test("the section filter applies after sectioning, so a stack keeps its place among the pull requests other sections hold", () => {
		const stacked = repo("webapp", [pr(1, { review: "approved" }), pr(2, { stackedOn: "me/branch-1" }), pr(3, { checks: "pending", stackedOn: "me/branch-2" })]);
		const [listed] = filteredList([stacked], { ...NO_FILTER, sections: new Set(["Approved"]) }, "", DEFAULT_ORDER, noAgent, false, 0);
		expect(listed!.sections.map(({ title, rows }) => [title, rows.map(({ pr: { number }, stack }) => [number, stack?.size])])).toEqual([["Approved", [[1, 3]]]]);
	});

	test("Repository lists each repository with its count, and a checked one that is gone stays, so you can uncheck it", () => {
		expect(repoOptions([...repos, broken], new Set(["acme/gone", "acme/api"]))).toEqual([
			{ key: "acme/webapp", label: "acme/webapp", count: 2 },
			{ key: "acme/api", label: "acme/api", count: 2 },
			{ key: "acme/broken", label: "acme/broken", count: 0 },
			{ key: "acme/gone", label: "acme/gone", count: 0 },
		]);
	});

	test("Author lists the author with the most pull requests first, and a checked one with none stays", () => {
		expect(authorOptions(repos, new Set(["ghost"]))).toEqual([
			{ key: "me", label: "me", count: 3 },
			{ key: "teammate", label: "teammate", count: 1 },
			{ key: "ghost", label: "ghost", count: 0 },
		]);
	});
});

describe("grouping", () => {
	const shape = (groups: ListGroup[]) => groups.map(({ title, cards }) => [title, cards.map(({ title, rows }) => [title, names(rows.map(({ row }) => row.pr))])]);

	test("by section, a heading per section in page order with a table per repository", () => {
		const groups = groupedList("section", unfiltered, DEFAULT_ORDER);
		expect(groups.map(({ title }) => title)).toEqual(sectionTitles(DEFAULT_ORDER).filter(title => groups.some(group => group.title === title)));
		expect(shape(groups).find(([title]) => title === "Your move")?.[1]).toEqual([
			["acme/webapp", ["webapp#2"]],
			["acme/api", ["api#3", "api#4"]],
		]);
	});

	test("by author, the author with the most pull requests first, a table per section across repositories; under no grouping, one table in section order", () => {
		expect(shape(groupedList("author", unfiltered, DEFAULT_ORDER))).toEqual([
			[
				"me",
				[
					["Your move", ["webapp#2", "api#4"]],
					["Waiting on others", ["webapp#1"]],
				],
			],
			["teammate", [["Your move", ["api#3"]]]],
		]);
		expect(foldedByDefault(cardFoldKey(groupFoldKey("author", "me"), "Waiting on others"))).toBe(true);
		const none = groupedList("none", unfiltered, DEFAULT_ORDER);
		expect(none).toHaveLength(1);
		expect(none[0]!.title).toBeNull();
		expect(names(shownPullRequests("none", none, () => false))).toEqual(["webapp#2", "api#3", "api#4", "webapp#1"]);
	});

	test("a folded heading hides its pull requests from the keys, and the merged heading starts folded", () => {
		const groups = groupedList("section", unfiltered, DEFAULT_ORDER);
		const folded = groupFoldKey("section", "Your move");
		expect(shownPullRequests("section", groups, key => key === folded).map(({ number }) => number)).not.toContain(2);
		expect(foldedByDefault(groupFoldKey("section", "Recently merged"))).toBe(true);
	});
});
