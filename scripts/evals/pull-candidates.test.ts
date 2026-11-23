import { describe, expect, test } from "bun:test";
import { baseOf, domainOf, leaks, type Pull, type PullFile, rejection, spread, testNodeIds, ticketFromBody, ticketOf, ticketPrompt } from "./pull-candidates";
import { type EvalRow, passAtK, passAtKRate } from "./run";

const pull = (extra: Partial<Pull> = {}): Pull => ({
	number: 7378,
	title: "fix(slack): escape support message fields",
	branch: "maxence/eng-2903-support-slack",
	body: "",
	mergedAt: "2026-11-20T10:00:00Z",
	mergeCommit: "a".repeat(40),
	...extra,
});
const file = (filename: string, additions = 10, status = "modified"): PullFile => ({ filename, status, additions, deletions: 0 });

describe("pull request selection", () => {
	test("finds the ticket in the title, then the branch, then the body", () => {
		expect(ticketOf(pull({ title: "fix: x (ENG-12)" }))).toBe("ENG-12");
		expect(ticketOf(pull())).toBe("ENG-2903");
		expect(ticketOf(pull({ branch: "fix/x", body: "Fixes eng-77" }))).toBe("ENG-77");
		expect(ticketOf(pull({ branch: "fix/x" }))).toBeNull();
	});

	test("keeps a ticketed backend change with tests, under the line limit and without migrations", () => {
		const ok = [file("yampa/utils/slack.py", 40), file("tests/utils/test_slack.py", 900)];
		expect(rejection(pull(), ok, "yampa", 400)).toBeNull();
		expect(rejection(pull({ branch: "fix/x" }), ok, "yampa", 400)).toBe("names no ticket");
		expect(rejection(pull(), [...ok, file("yampa/databases/migrations/versions/abc.py")], "yampa", 400)).toBe("adds a migration");
		expect(rejection(pull(), [file("front/app.tsx"), file("tests/utils/test_slack.py")], "yampa", 400)).toBe("changes no Python under yampa/");
		expect(rejection(pull(), [file("yampa/utils/slack.py")], "yampa", 400)).toBe("adds or changes no test");
		expect(rejection(pull(), [file("yampa/utils/slack.py"), file("tests/utils/test_slack.py", 5, "removed")], "yampa", 400)).toBe(
			"adds or changes no test",
		);
		expect(rejection(pull(), [file("yampa/utils/slack.py", 300), file("front/a.tsx", 100), file("tests/test_a.py")], "yampa", 400)).toBe(
			"changes 400 lines outside tests/",
		);
	});

	test("names the package folder with the most changed lines", () => {
		expect(domainOf([file("yampa/utils/a.py", 5), file("yampa/agents/b.py", 20), file("yampa/agents/c.py", 1), file("tests/agents/test_b.py", 99)], "yampa")).toBe(
			"agents",
		);
		expect(domainOf([file("yampa/settings.py")], "yampa")).toBe("(root)");
	});

	test("spreads picks across folders before repeating one, keeping the given order", () => {
		const items = ["a1", "a2", "a3", "b1", "a4", "c1"].map(id => ({ id, domain: id[0]! }));
		expect(spread(items, 2).map(item => item.id)).toEqual(["a1", "a2", "b1", "c1", "a3", "a4"]);
	});
});

describe("base commit", () => {
	test("a squash merge starts from its single parent", () => {
		expect(baseOf({ parents: ["p1"], subject: "fix(slack): escape fields (#7378)" }, 7378)).toBe("p1");
	});

	test("a merge commit starts from its first parent, the target branch", () => {
		expect(baseOf({ parents: ["main-tip", "branch-tip"], subject: "Merge pull request #4647 from yampa-ai/fix/x" }, 4647)).toBe("main-tip");
	});

	test("a rebase merge has no single base", () => {
		expect(baseOf({ parents: ["previous-pr-commit"], subject: "fix(slack): escape fields" }, 7378)).toBeNull();
	});
});

describe("hidden tests", () => {
	test("lists module tests and test methods of Test classes as pytest node ids", () => {
		const source = [
			"import pytest",
			"",
			"@pytest.mark.parametrize('x', [1, 2])",
			"def test_escapes(x):",
			"    def test_inner():",
			"        pass",
			"",
			"async def test_posts():",
			"    pass",
			"",
			"class TestSlack:",
			"    @pytest.fixture",
			"    def client(self):",
			"        pass",
			"",
			"    async def test_sends(self, client):",
			"        pass",
			"",
			"class Helper:",
			"    def test_not_collected(self):",
			"        pass",
			"",
			"def helper():",
			"    pass",
		].join("\n");
		expect(testNodeIds("tests/utils/test_slack.py", source)).toEqual([
			"tests/utils/test_slack.py::test_escapes",
			"tests/utils/test_slack.py::test_posts",
			"tests/utils/test_slack.py::TestSlack::test_sends",
		]);
	});

	test("a support file such as conftest.py holds no test", () => {
		expect(testNodeIds("tests/conftest.py", "def test_like_name():\n    pass\n")).toEqual([]);
		expect(testNodeIds("tests/factories.py", "def test_like_name():\n    pass\n")).toEqual([]);
	});
});

describe("prompt", () => {
	test("a ticket's Linear mentions become their labels", () => {
		const prompt = ticketPrompt("ENG-2827", 'Count attachments\n\nDepends on <issue id="d1" label="ENG-2818" href="https://linear.app/x" />.');
		expect(prompt).toContain("Do Linear ticket ENG-2827 in the repository");
		expect(prompt).toContain("Depends on ENG-2818.");
		expect(prompt).not.toContain("<issue");
	});

	test("a pull request's body keeps only its first section, without code, images, or the bot summary", () => {
		const body = [
			"## Why",
			"People could not log out. See ![shot](https://x/y.png)",
			"```diff",
			"+ fixed()",
			"```",
			"## What",
			"Moved the avatar inside the trigger.",
			"<!-- CURSOR_SUMMARY -->",
			"Adds a test_lobby test.",
			"<!-- /CURSOR_SUMMARY -->",
		].join("\n");
		expect(ticketFromBody("fix(front): show the avatar (ENG-3108)", body)).toBe("fix(front): show the avatar\n\nPeople could not log out. See");
	});

	test("flags a prompt that names a hidden test, a hidden file, the pull request, or a diff", () => {
		const hidden = { files: ["tests/utils/test_slack.py", "tests/conftest.py"], testIds: ["tests/utils/test_slack.py::test_escapes_fields"] };
		expect(leaks("Escape Slack fields.", hidden, 7378)).toEqual([]);
		expect(leaks("Make test_escapes_fields pass; see test_slack.py and #7378.\n```py\nx\n```", hidden, 7378)).toEqual([
			"test_escapes_fields",
			"tests/utils/test_slack.py",
			"#7378",
			"code block or diff",
		]);
		expect(leaks("Same as #73780.", hidden, 7378)).toEqual([]);
	});
});

describe("pass@k", () => {
	test("is the chance that one of k runs drawn from n passes", () => {
		expect(passAtK(3, 0, 1)).toBe(0);
		expect(passAtK(3, 1, 1)).toBeCloseTo(1 / 3);
		expect(passAtK(3, 3, 1)).toBe(1);
		expect(passAtK(3, 1, 3)).toBe(1);
		expect(passAtK(3, 0, 3)).toBe(0);
		expect(passAtK(5, 2, 3)).toBeCloseTo(1 - 1 / 10);
		expect(passAtK(2, 1, 3)).toBeNull();
	});

	const row = (task: string, passed: boolean, extra: Partial<EvalRow> = {}): EvalRow => ({
		at: "",
		task,
		arm: "full",
		disabled: [],
		run: 1,
		model: "anthropic/claude-opus-5-5:auto",
		error: null,
		passed,
		failures: [],
		exitCode: 0,
		minutes: 1,
		cost: 1,
		requests: 1,
		outputTokens: 1,
		answeredBy: { "anthropic/claude-opus-5-5": 1 },
		filesChanged: 1,
		linesChanged: 1,
		...extra,
	});

	test("averages over tasks with enough scored runs, leaving out unanswered ones", () => {
		const rows = [
			row("a", true),
			row("a", false),
			row("a", false),
			row("b", false),
			row("b", false),
			row("b", false),
			row("c", true),
			row("c", true),
			row("c", false, { error: "usage limit" }),
		];
		expect(passAtKRate(rows, 3)).toBe(0.5);
		expect(passAtKRate(rows, 1)).toBeCloseTo((1 / 3 + 0 + 1) / 3);
		expect(passAtKRate([], 3)).toBeNull();
	});
});
