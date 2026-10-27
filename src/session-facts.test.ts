import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CachedCheckouts, type CheckoutReads } from "./git";
import { runChecked } from "./proc";
import { parseShipProgress, type PullRequestRef, resolveLinks, SessionFactsIndex, SessionFactsScan } from "./session-facts";

/** No checkout anywhere, for tests that need no git. */
const NO_GIT: CheckoutReads = { worktreeAt: async () => null, headHistory: async () => null, defaultBranchOf: async () => null };

const toolCall = (id: string, name: string, args: object) =>
	JSON.stringify({
		type: "message",
		message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] },
	});
const bashCall = (id: string, command: string) => toolCall(id, "bash", { command });
const result = (toolCallId: string, text: string, details?: object) =>
	JSON.stringify({
		type: "message",
		message: { role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text }], details },
	});
const waited = (jobs: { id: string; type: string; resultText: string }[]) =>
	JSON.stringify({
		type: "message",
		message: { role: "toolResult", toolCallId: "w", toolName: "wait", content: [{ type: "text", text: "## Completed" }], details: { jobs } },
	});
const delivered = (jobId: string, content: string) =>
	JSON.stringify({ type: "custom_message", customType: "async-result", content, details: { jobs: [{ jobId, type: "bash" }] } });
const gtLine = (n: number) => `me/b${n}: https://app.graphite.com/github/pr/o/r/${n} (created)`;
const pushed = (branch: string) => `To github.com:acme/webapp.git\n   1a2b3c4d..5e6f7a8b  HEAD -> ${branch}\n`;
const submitted = (owner: string, repo: string, number: number) => ({ kind: "pr", link: "submitted", owner, repo, number }) as const;
const worked = (owner: string, repo: string, number: number) => ({ kind: "pr", link: "worked", owner, repo, number }) as const;
const prompt = (text: string) => JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
const skillPrompt = (args: string) =>
	JSON.stringify({ type: "custom_message", customType: "skill-prompt", attribution: "user", content: "[IMPORTANT: User invoked the \"ship\" skill.] ENG-1 #1", details: { name: "ship", args } });
const linear = (id: string, tool: string, args: object) => toolCall(id, `mcp__linear_${tool}`, args);

const scanOf = (lines: string[], prompts = true) => {
	const scan = new SessionFactsScan(prompts);
	for (const line of lines) scan.applyLine(line);
	return scan;
};
const scanned = (lines: string[]) => [...scanOf(lines).found.values()];

describe("SessionFactsScan", () => {
	test("every branch a gt submit created or updated, once each", () => {
		const output = [
			"🥞 Pushing to remote and creating/updating PRs for stack...",
			"me/a: https://app.graphite.com/github/pr/acme/webapp/6595 (updated)",
			"me/b: https://app.graphite.com/github/pr/acme/webapp/6596 (created)",
		].join("\n");
		expect(scanned([bashCall("c1", "gt submit --stack"), result("c1", output), result("c2", output)])).toEqual([
			submitted("acme", "webapp", 6595),
			submitted("acme", "webapp", 6596),
		]);
	});

	test("the URL gh pr create prints, but not a URL another command prints", () => {
		const created = "Creating pull request for me/c into main\n\nhttps://github.com/acme/webapp/pull/6600\n";
		expect(
			scanned([
				bashCall("view", "gh pr view 6551 --json url -q .url"),
				result("view", "https://github.com/acme/webapp/pull/6551"),
				bashCall("create", "cd ~/code/webapp && gh pr create --fill"),
				result("create", created),
			]),
		).toEqual([submitted("acme", "webapp", 6600)]);
	});

	test("a background gt submit's output, whether delivered or waited for", () => {
		expect(scanned([delivered("bg_1", `Background job bg_1 has completed.\n${gtLine(1)}`), waited([{ id: "bg_2", type: "bash", resultText: gtLine(2) }])])).toEqual([
			submitted("o", "r", 1),
			submitted("o", "r", 2),
		]);
	});

	test("a background gh pr create's URL arrives with its job", () => {
		expect(
			scanned([
				bashCall("create", "gh pr create --fill"),
				result("create", "Backgrounded as job bg_3", { async: { state: "running", jobId: "bg_3", type: "bash" } }),
				delivered("bg_9", "https://github.com/o/r/pull/9"),
				delivered("bg_3", "https://github.com/o/r/pull/3"),
			]),
		).toEqual([submitted("o", "r", 3)]);
	});

	test("a gt submit line a subagent's report quotes is a mention, not a submission", () => {
		expect(scanned([waited([{ id: "Reviewer", type: "task", resultText: `e.g.\n${gtLine(4)}` }])])).toEqual([]);
	});

	test("a gh pr action names its PR by number, URL, or --repo; a list, a view, or a quoted command does not", () => {
		expect(
			scanned([
				bashCall("a", "gh pr checkout 6601 && gh pr list --author @me"),
				bashCall("b", 'cd ~/code/webapp && gh pr comment https://github.com/acme/webapp/pull/6602 --body "done"'),
				bashCall("c", "gh pr merge --repo acme/api 7 --squash; gh pr review -R acme/api '#8' --approve"),
				bashCall("d", 'gh pr view 6603 && git commit -m "gh pr edit 6604 later" && gh pr edit --add-label ready'),
			]),
		).toEqual([{ kind: "number", number: 6601 }, worked("acme", "webapp", 6602), worked("acme", "api", 7), worked("acme", "api", 8)]);
	});

	test("an omp pr:// read is a read of its PR, with or without its repository", () => {
		expect(
			scanned([
				toolCall("r1", "read", { path: "pr://6605/diff/all" }),
				toolCall("r2", "read", { path: "pr://acme/api/9?comments=1" }),
				toolCall("r3", "read", { path: "pr://" }),
				toolCall("r4", "read", { path: "issue://6606" }),
			]),
		).toEqual([
			{ kind: "read", repository: null, number: 6605 },
			{ kind: "read", repository: { owner: "acme", repo: "api" }, number: 9 },
		]);
	});

	test("the session's own prompts link the PRs their GitHub URLs name and name the numbers they write as #N or PR N; a subagent's prompt does neither", () => {
		const lines = [
			prompt("Fix https://github.com/acme/api/pull/5 and #12, PR 13, pr#14, not acme/webapp#15, &#16; or issue 18"),
			skillPrompt("review PR #17"),
			prompt("[omp-agents] Project update. #19"),
		];
		const own = scanOf(lines);
		expect([[...own.found.values()], [...own.named]]).toEqual([[{ ...worked("acme", "api", 5), named: true }], [12, 13, 14, 17]]);
		const subagent = scanOf(lines, false);
		expect([[...subagent.found.values()], [...subagent.named]]).toEqual([[], []]);
	});

	test("the branches a git push updated, but not a rejected push or push output another command prints", () => {
		const forced = "To https://github.com/acme/webapp.git\n + 1a2b3c4d...5e6f7a8b me/forced -> me/forced (forced update)\n";
		const rejected = "To github.com:acme/webapp.git\n ! [rejected]        me/stale -> me/stale (non-fast-forward)\n";
		expect(
			scanned([
				bashCall("p1", "git push origin HEAD 2>&1 | tail -3"),
				result("p1", pushed("me/feature")),
				bashCall("p2", "git -C /tmp/wt push --force-with-lease"),
				result("p2", forced),
				bashCall("p3", "git push"),
				result("p3", rejected),
				bashCall("cat", "cat push.log"),
				result("cat", pushed("me/quoted")),
			]),
		).toEqual([
			{ kind: "branch", owner: "acme", repo: "webapp", branch: "me/feature", link: "worked" },
			{ kind: "branch", owner: "acme", repo: "webapp", branch: "me/forced", link: "worked" },
		]);
	});

	test("a submission outranks earlier work on the same PR and keeps its place", () => {
		expect(
			scanned([
				bashCall("a", "gh pr checkout -R o/r 1"),
				bashCall("b", "gh pr checkout -R o/r 2"),
				bashCall("s", "gt submit"),
				result("s", gtLine(1)),
			]),
		).toEqual([submitted("o", "r", 1), worked("o", "r", 2)]);
	});

	test("what names each Linear issue: work on it, a read, or the session's own prompt, but not a search's listing or a subagent's prompt", () => {
		const device = (id: string, tool: string, args: object) => toolCall(id, "write", { path: `xd://mcp__linear_${tool}`, content: JSON.stringify(args) });
		const answered = (toolCallId: string, text: string, isError = false) =>
			JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId, toolName: "write", isError, content: [{ type: "text", text }] } });
		const lines = [
			prompt("Do https://linear.app/acme/issue/ENG-7/some-title, see ENG-8"),
			toolCall("a", "mcp__linear_list_issues", { query: "ENG-1" }),
			toolCall("b", "mcp__linear_get_issue", { id: "eng-2" }),
			toolCall("c", "mcp__linear_get_issue", { id: "c07eebf1-444b-449f-b31d-a43d2b62504a" }),
			device("d", "save_comment", { issueId: "ENG-3", body: "Done" }),
			device("e", "save_issue", { team: "ENG", title: "New" }),
			answered("e", JSON.stringify({ id: "ENG-4", title: "New" })),
			device("f", "save_issue", { team: "ENG", title: "Refused" }),
			answered("f", JSON.stringify({ id: "ENG-5" }), true),
			toolCall("g", "xd_mcp__linear_list_comments", { issueId: "ENG-2" }),
			JSON.stringify({ type: "custom", customType: "omp-ship.state", data: { stage: "ticket", issue: "ENG-6" } }),
			linear("h", "get_issue", { id: "ENG-8" }),
			linear("i", "save_issue", { id: "ENG-2", title: "Renamed" }),
		];
		const evidence = (prompts: boolean) => [...scanOf(lines, prompts).tickets].map(([id, kinds]) => [id, [...kinds]]);
		expect(evidence(true)).toEqual([
			["ENG-7", ["worked", "named"]],
			["ENG-8", ["named", "read"]],
			["ENG-2", ["read", "worked"]],
			["ENG-3", ["worked"]],
			["ENG-4", ["worked"]],
			["ENG-6", ["worked"]],
		]);
		expect(evidence(false)).toEqual([
			["ENG-2", ["read", "worked"]],
			["ENG-3", ["worked"]],
			["ENG-4", ["worked"]],
			["ENG-6", ["worked"]],
			["ENG-8", ["read"]],
		]);
	});
});

describe("resolveLinks", () => {
	const heads = new Map([["acme/webapp:me/feature", { owner: "acme", repo: "webapp", number: 6610 }]]);

	test("a bare number is in the session's repository and a pushed branch is the PR it heads", () => {
		expect(
			resolveLinks(
				[
					{ kind: "number", number: 6609 },
					{ kind: "branch", owner: "Acme", repo: "WebApp", branch: "me/feature", link: "worked" },
					{ kind: "branch", owner: "acme", repo: "webapp", branch: "me/no-pr", link: "worked" },
				],
				{ owner: "acme", repo: "webapp" },
				heads,
			),
		).toEqual([
			{ owner: "acme", repo: "webapp", number: 6609, link: "worked" },
			{ owner: "acme", repo: "webapp", number: 6610, link: "worked" },
		]);
	});

	test("the PRs calls worked on come before those the prompt only links, each in the order found", () => {
		const numbers = (lines: string[]) => resolveLinks(scanned(lines) as PullRequestRef[], { owner: "acme", repo: "webapp" }, heads).map(pr => pr.number);
		const linking = prompt("help me finish https://github.com/acme/webapp/pull/7060 and https://github.com/acme/webapp/pull/7061");
		expect(numbers([linking, bashCall("edit", "gh pr edit 7064 --title Follow-up")])).toEqual([7064, 7060, 7061]);
		expect(numbers([linking, bashCall("edit", "gh pr edit 7064 --title Follow-up"), bashCall("view", "gh pr checkout https://github.com/acme/webapp/pull/7061")])).toEqual([
			7061, 7064, 7060,
		]);
	});

	test("without a repository a bare number links nowhere, and one PR found twice keeps the submission", () => {
		expect(
			resolveLinks(
				[{ kind: "number", number: 1 }, { kind: "branch", owner: "acme", repo: "webapp", branch: "me/feature", link: "worked" }, submitted("ACME", "webapp", 6610)],
				null,
				heads,
			),
		).toEqual([{ owner: "acme", repo: "webapp", number: 6610, link: "submitted" }]);
	});
});

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sessionDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-prs-"));
	dirs.push(dir);
	return dir;
};

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", "-C", cwd, ...args], { env: IDENTITY });

/** A repository at `<parent>/app` on `main`, with `wip` and `done` checked out in worktrees `app-wip` and `app-done`. Returns the main checkout. */
async function repoWithWorktrees(parent: string): Promise<string> {
	const main = join(parent, "app");
	mkdirSync(main);
	await git(main, "init", "-q", "-b", "main");
	await git(main, "commit", "-q", "--allow-empty", "-m", "one");
	await git(main, "worktree", "add", "-q", "-b", "wip", join(parent, "app-wip"));
	await git(main, "worktree", "add", "-q", "-b", "done", join(parent, "app-done"));
	return main;
}

describe("SessionFactsIndex", () => {
	test("folds in subagents' submissions and picks up appends once the session file changes", async () => {
		const dir = sessionDir();
		const session = join(dir, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const line = (n: number) => result(`r${n}`, gtLine(n));
		writeFileSync(session, `${line(1)}\n`);
		mkdirSync(join(dir, "2026-10-01T00-00-00-000Z_s1", "Child"), { recursive: true });
		writeFileSync(join(dir, "2026-10-01T00-00-00-000Z_s1", "Child", "Grandchild.jsonl"), `${line(2)}\n`);

		const index = new SessionFactsIndex(async () => null, NO_GIT);
		const listed = (modifiedAt: number) => [{ path: session, cwd: dir, modifiedAt }];
		expect(await index.refresh(listed(1))).toBe(true);
		expect(index.factsOf(session).pullRequests.map(pr => pr.number)).toEqual([1, 2]);

		appendFileSync(session, `${line(3)}\n${line(4).slice(0, 20)}`);
		expect(await index.refresh(listed(1))).toBe(false);
		expect(index.factsOf(session).pullRequests.map(pr => pr.number)).toEqual([1, 2]);
		expect(await index.refresh(listed(2))).toBe(true);
		expect(index.factsOf(session).pullRequests.map(pr => pr.number)).toEqual([1, 3, 2]);

		expect(await index.refresh([])).toBe(false);
		expect(index.factsOf(session).pullRequests).toEqual([]);
	});

	test("shows the latest parent workflow stage and picks up live review work on append", async () => {
		const dir = sessionDir();
		const session = join(dir, "2026-10-01T00-00-00-000Z_ship.jsonl");
		const state = (stage: string, work?: string) => JSON.stringify({
			type: "custom", customType: "omp-ship.state", data: { stage, work, issue: "ENG-123", pr: 42, updatedAt: new Date(0).toISOString() },
		});
		writeFileSync(session, `${state("thermonuclear")}\n`);
		const child = join(dir, "2026-10-01T00-00-00-000Z_ship", "Child");
		mkdirSync(child, { recursive: true });
		writeFileSync(join(child, "sub.jsonl"), `${state("merged")}\n`);
		const index = new SessionFactsIndex(async () => null, NO_GIT);
		const listed = (modifiedAt: number) => [{ path: session, cwd: dir, modifiedAt }];

		expect(await index.refresh(listed(1))).toBe(true);
		expect(index.factsOf(session).ship).toEqual({ stage: "thermonuclear", issue: "ENG-123", pr: 42 });
		appendFileSync(session, `${state("live", "rebase")}\n`);
		expect(await index.refresh(listed(2))).toBe(true);
		expect(index.factsOf(session).ship).toEqual({ stage: "live", work: "rebase", issue: "ENG-123", pr: 42 });
		appendFileSync(session, `${state("unknown")}\n`);
		expect(await index.refresh(listed(3))).toBe(false);
		expect(index.factsOf(session).ship?.work).toBe("rebase");
	});

	test("lists the Linear issues the session and its subagents worked on, the session's own first, each once, and reports a new one on append", async () => {
		const dir = sessionDir();
		const session = join(dir, "2026-10-01T00-00-00-000Z_tickets.jsonl");
		const comment = (id: string) => linear(`c-${id}`, "save_comment", { issueId: id, body: "Done" });
		writeFileSync(session, `${comment("ENG-1")}\n`);
		const child = join(dir, "2026-10-01T00-00-00-000Z_tickets");
		mkdirSync(child, { recursive: true });
		writeFileSync(join(child, "Sub.jsonl"), `${comment("ENG-2")}\n${comment("ENG-1")}\n`);
		const index = new SessionFactsIndex(async () => null, NO_GIT);
		const listed = (modifiedAt: number) => [{ path: session, cwd: dir, modifiedAt }];

		expect(await index.refresh(listed(1))).toBe(true);
		expect(index.factsOf(session).tickets).toEqual(["ENG-1", "ENG-2"]);
		appendFileSync(session, `${comment("ENG-1")}\n`);
		expect(await index.refresh(listed(2))).toBe(false);
		appendFileSync(session, `${comment("ENG-3")}\n`);
		expect(await index.refresh(listed(3))).toBe(true);
		expect(index.factsOf(session).tickets).toEqual(["ENG-1", "ENG-3", "ENG-2"]);
	});

	test("links a Linear issue it only read, or that its own prompt or its branch names, once two of those agree; a subagent's prompt does not count", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		await git(main, "worktree", "add", "-q", "-b", "mma/eng-9-fix", join(parent, "app-eng-9"));
		const session = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const read = (id: string) => linear(`get-${id}`, "get_issue", { id });
		writeFileSync(session, `${[prompt("Pick up ENG-8 and ENG-9, with ENG-12"), read("ENG-8"), read("ENG-10"), read("ENG-11")].join("\n")}\n`);
		const child = join(parent, "2026-10-01T00-00-00-000Z_s1", "Sub");
		mkdirSync(child, { recursive: true });
		writeFileSync(join(child, "sub.jsonl"), `${[prompt("Context: ENG-13 and ENG-10"), read("ENG-13"), read("ENG-12")].join("\n")}\n`);
		const index = new SessionFactsIndex(async () => null, new CachedCheckouts());

		expect(await index.refresh([{ path: session, cwd: join(parent, "app-eng-9"), modifiedAt: 1 }])).toBe(true);
		expect(index.factsOf(session).tickets).toEqual(["ENG-8", "ENG-9", "ENG-12"]);
		await git(join(parent, "app-eng-9"), "switch", "-q", "-c", "eng-11");
		appendFileSync(session, `${bashCall("b", "bun test")}\n`);
		expect(await index.refresh([{ path: session, cwd: join(parent, "app-eng-9"), modifiedAt: 2 }])).toBe(true);
		expect(index.factsOf(session).tickets).toEqual(["ENG-8", "ENG-12", "ENG-11"]);
	});

	test("links a pr:// read only of a PR the session's own prompt names in its repository, and the PR its prompt links", async () => {
		const dir = sessionDir();
		const session = join(dir, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const read = (path: string) => toolCall(`r-${path}`, "read", { path });
		writeFileSync(
			session,
			`${[prompt("Review #12 and PR 13 against https://github.com/acme/api/pull/5"), read("pr://14"), read("pr://12"), read("pr://acme/api/13"), read("pr://Acme/WebApp/13/diff/all")].join("\n")}\n`,
		);
		const child = join(dir, "2026-10-01T00-00-00-000Z_s1", "Audit");
		mkdirSync(child, { recursive: true });
		writeFileSync(join(child, "audit.jsonl"), `${[prompt("Audit #15"), read("pr://15"), read("pr://12")].join("\n")}\n`);
		const index = new SessionFactsIndex(async () => ({ owner: "acme", repo: "webapp" }), NO_GIT);

		expect(await index.refresh([{ path: session, cwd: dir, modifiedAt: 1 }])).toBe(true);
		expect(index.factsOf(session).pullRequests).toEqual([
			{ owner: "acme", repo: "api", number: 5, link: "worked" },
			{ owner: "acme", repo: "webapp", number: 12, link: "worked" },
			{ owner: "Acme", repo: "WebApp", number: 13, link: "worked" },
		]);
	});

	test("asks for the repository only of sessions that name a bare number, and links pushes once the pull request list names their PR", async () => {
		const dir = sessionDir();
		const reader = join(dir, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const pusher = join(dir, "2026-10-01T00-00-00-000Z_s2.jsonl");
		writeFileSync(reader, `${bashCall("r", "gh pr checkout 6611")}\n`);
		writeFileSync(pusher, `${bashCall("p", "git push")}\n${result("p", pushed("me/feature"))}\n`);
		const asked: string[] = [];
		const index = new SessionFactsIndex(
			async cwd => {
				asked.push(cwd);
				return { owner: "acme", repo: "webapp" };
			},
			NO_GIT,
		);

		expect(
			await index.refresh([
				{ path: reader, cwd: "/code/webapp", modifiedAt: 1 },
				{ path: pusher, cwd: "/code/other", modifiedAt: 1 },
			]),
		).toBe(true);
		expect(asked).toEqual(["/code/webapp"]);
		expect(index.factsOf(reader).pullRequests).toEqual([{ owner: "acme", repo: "webapp", number: 6611, link: "worked" }]);
		expect(index.factsOf(pusher).pullRequests).toEqual([]);

		const pullRequests = [{ owner: "acme", repo: "webapp", number: 6612, head: "me/feature" }];
		expect(index.learnHeads({ owner: "acme", repo: "webapp" }, pullRequests)).toBe(true);
		expect(index.factsOf(pusher).pullRequests).toEqual([{ owner: "acme", repo: "webapp", number: 6612, link: "worked" }]);
		expect(index.learnHeads({ owner: "acme", repo: "webapp" }, pullRequests)).toBe(false);
		expect(index.learnHeads({ owner: "acme", repo: "webapp" }, [])).toBe(true);
		expect(index.factsOf(pusher).pullRequests).toEqual([]);
	});

	test("names the linked worktree the session's own bash calls last ran in, passing over others, and none once it is gone", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		mkdirSync(join(main, "src"));
		const other = join(parent, "other");
		mkdirSync(other);
		await git(other, "init", "-q");
		mkdirSync(join(parent, "plain"));

		const session = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const ran = (cwd: string) => toolCall(`b-${cwd}`, "bash", { command: "bun test", cwd });
		const child = join(parent, "2026-10-01T00-00-00-000Z_s1", "Sub");
		mkdirSync(child, { recursive: true });
		writeFileSync(join(child, "sub.jsonl"), `${ran(join(parent, "app-done"))}\n`);
		writeFileSync(session, `${ran("../../app-done")}\n${ran("../../app-wip")}\n`);
		const index = new SessionFactsIndex(async () => null, new CachedCheckouts());
		const listed = (modifiedAt: number) => [{ path: session, cwd: join(main, "src"), modifiedAt }];

		expect(await index.refresh(listed(1))).toBe(true);
		expect(index.factsOf(session).worktree).toBe(join(parent, "app-wip"));
		appendFileSync(session, `${ran(main)}\n${ran(other)}\n${ran("../../plain")}\n`);
		expect(await index.refresh(listed(2))).toBe(false);
		expect(index.factsOf(session).worktree).toBe(join(parent, "app-wip"));
		appendFileSync(session, `${ran("../../app-done")}\n`);
		expect(await index.refresh(listed(3))).toBe(true);
		expect(index.factsOf(session).worktree).toBe(join(parent, "app-done"));
		await git(main, "worktree", "remove", join(parent, "app-done"));
		appendFileSync(session, `${ran("../../app-wip")}\n${ran("../../app-done")}\n`);
		expect(await index.refresh(listed(4))).toBe(true);
		expect(index.factsOf(session).worktree).toBeNull();
	});

	test("names the branch of the linked worktree a session works in, follows a branch switch, and links the PR that heads it, not the main checkout's", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		await git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
		await git(main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
		const inWorktree = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const intoWorktree = join(parent, "2026-10-01T00-00-00-000Z_s2.jsonl");
		const inMain = join(parent, "2026-10-01T00-00-00-000Z_s3.jsonl");
		const ran = (cwd: string) => toolCall(`b-${cwd}`, "bash", { command: "bun test", cwd });
		writeFileSync(inWorktree, `${ran(".")}\n`);
		writeFileSync(intoWorktree, `${ran(join(parent, "app-done"))}\n`);
		writeFileSync(inMain, `${ran(".")}\n`);
		const repo = { owner: "acme", repo: "webapp" };
		const listed = (modifiedAt: number) => [
			{ path: inWorktree, cwd: join(parent, "app-wip"), modifiedAt },
			{ path: intoWorktree, cwd: main, modifiedAt },
			{ path: inMain, cwd: main, modifiedAt },
		];
		const heads = ["wip", "done", "main", "next"].map((head, i) => ({ ...repo, number: i + 1, head }));
		const linked = (number: number) => [{ ...repo, number, link: "worked" as const }];
		const index = new SessionFactsIndex(async () => repo, new CachedCheckouts());

		await index.refresh(listed(1));
		expect(index.factsOf(inWorktree).branch).toEqual({ name: "wip", linked: true, defaultBranch: "main", pullRequest: null });
		expect(index.learnHeads(repo, heads)).toBe(true);
		expect(index.factsOf(inWorktree).pullRequests).toEqual(linked(1));
		expect(index.factsOf(intoWorktree).pullRequests).toEqual(linked(2));
		expect(index.factsOf(inMain).pullRequests).toEqual([]);
		expect([inWorktree, intoWorktree, inMain].map(path => index.factsOf(path).branch)).toEqual([
			{ name: "wip", linked: true, defaultBranch: "main", pullRequest: { ...repo, number: 1 } },
			{ name: "done", linked: true, defaultBranch: "main", pullRequest: { ...repo, number: 2 } },
			{ name: "main", linked: false, defaultBranch: "main", pullRequest: null },
		]);

		await git(join(parent, "app-wip"), "switch", "-q", "-c", "next");
		await git(join(parent, "app-done"), "switch", "-q", "--detach");
		appendFileSync(inWorktree, `${ran(".")}\n`);
		appendFileSync(intoWorktree, `${ran(join(parent, "app-done"))}\n`);
		expect(await index.refresh(listed(2))).toBe(true);
		expect(index.factsOf(inWorktree).pullRequests).toEqual(linked(4));
		expect(index.factsOf(intoWorktree).pullRequests).toEqual([]);
		expect([inWorktree, intoWorktree].map(path => index.factsOf(path).branch)).toEqual([
			{ name: "next", linked: true, defaultBranch: "main", pullRequest: { ...repo, number: 4 } },
			null,
		]);

		const offGitHub = new SessionFactsIndex(async () => null, new CachedCheckouts());
		await offGitHub.refresh(listed(1));
		offGitHub.learnHeads(repo, heads);
		expect(offGitHub.factsOf(inWorktree).pullRequests).toEqual([]);
		await git(join(parent, "app-wip"), "switch", "-q", "wip");
		appendFileSync(inWorktree, `${ran(".")}\n`);
		expect(await offGitHub.refresh(listed(3))).toBe(true);
		expect(offGitHub.factsOf(inWorktree).branch).toEqual({ name: "wip", linked: true, defaultBranch: "main", pullRequest: null });
	});

	test("asks GitHub which PR its branch heads whenever its transcripts name a new PR, keeps the answer until the pull request list names the branch", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		await git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
		await git(main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
		const session = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		writeFileSync(session, `${bashCall("b", "bun test")}\n`);
		const repo = { owner: "acme", repo: "webapp" };
		let heading: { owner: string; repo: string; number: number } | null = null;
		const asked: string[] = [];
		const index = new SessionFactsIndex(async () => repo, new CachedCheckouts(), [], async (at, branch) => {
			asked.push(`${at.owner}/${at.repo}:${branch}`);
			return heading;
		});
		const listed = (modifiedAt: number) => [{ path: session, cwd: join(parent, "app-wip"), modifiedAt }];

		await index.refresh(listed(1));
		expect(index.factsOf(session).branch).toEqual({ name: "wip", linked: true, defaultBranch: "main", pullRequest: null });
		heading = { ...repo, number: 9 };
		appendFileSync(session, `${bashCall("create", "gh pr create --base main --head wip")}\n${result("create", "https://github.com/acme/webapp/pull/9")}\n`);
		expect(await index.refresh(listed(2))).toBe(true);
		expect(index.factsOf(session).branch).toEqual({ name: "wip", linked: true, defaultBranch: "main", pullRequest: { ...repo, number: 9 } });
		appendFileSync(session, `${bashCall("t", "bun test")}\n`);
		await index.refresh(listed(3));
		expect(asked).toEqual(["acme/webapp:wip", "acme/webapp:wip"]);

		expect(index.learnHeads(repo, [])).toBe(false);
		expect(index.factsOf(session).branch?.pullRequest).toEqual({ ...repo, number: 9 });
		expect(index.learnHeads(repo, [{ ...repo, number: 11, head: "wip" }])).toBe(true);
		expect(index.factsOf(session).branch?.pullRequest).toEqual({ ...repo, number: 11 });
		expect(index.learnHeads(repo, [])).toBe(true);
		expect(index.factsOf(session).branch?.pullRequest).toBeNull();
	});

	test("the PR a gt submit printed for the session's branch heads it at once, and through list reads that do not name the branch, until one does", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		await git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
		await git(main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
		const session = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		writeFileSync(session, `${bashCall("s", "gt submit --no-edit")}\n${result("s", "wip: https://app.graphite.com/github/pr/acme/webapp/9 (created)")}\n`);
		const repo = { owner: "acme", repo: "webapp" };
		const index = new SessionFactsIndex(async () => repo, new CachedCheckouts(), [], async () => ({ ...repo, number: 9 }));

		await index.refresh([{ path: session, cwd: join(parent, "app-wip"), modifiedAt: 1 }]);
		expect(index.factsOf(session).branch).toEqual({ name: "wip", linked: true, defaultBranch: "main", pullRequest: { ...repo, number: 9 } });
		expect(index.factsOf(session).pullRequests).toEqual([{ ...repo, number: 9, link: "submitted" }]);
		expect(index.learnHeads(repo, [])).toBe(false);
		expect(index.factsOf(session).branch?.pullRequest).toEqual({ ...repo, number: 9 });
		expect(index.learnHeads(repo, [{ ...repo, number: 11, head: "wip" }])).toBe(true);
		expect(index.factsOf(session).branch?.pullRequest).toEqual({ ...repo, number: 11 });
	});

	test("GitHub's answer replaces the PR a gt submit printed for the session's branch, or removes it when the branch heads no open or merged PR, and a later write does not bring the printed one back", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		await git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
		await git(main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
		const session = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		writeFileSync(session, `${bashCall("s", "gt submit --no-edit")}\n${result("s", "wip: https://app.graphite.com/github/pr/acme/webapp/9 (created)")}\n`);
		const repo = { owner: "acme", repo: "webapp" };
		let heading: { owner: string; repo: string; number: number } | null = null;
		const asked: string[] = [];
		const index = new SessionFactsIndex(async () => repo, new CachedCheckouts(), [], async (_, branch) => {
			asked.push(branch);
			return heading;
		});
		const start = Date.now();
		const writeAt = async (seconds: number) => {
			setSystemTime(new Date(start + seconds * 1000));
			appendFileSync(session, `${bashCall("t", "bun test")}\n`);
			await index.refresh([{ path: session, cwd: join(parent, "app-wip"), modifiedAt: seconds + 1 }]);
		};

		try {
			setSystemTime(new Date(start));
			await index.refresh([{ path: session, cwd: join(parent, "app-wip"), modifiedAt: 0 }]);
			expect(asked).toEqual(["wip"]);
			expect(index.factsOf(session).branch?.pullRequest).toBeNull();
			expect(index.factsOf(session).pullRequests).toEqual([{ ...repo, number: 9, link: "submitted" }]);
			await writeAt(10);
			expect(asked).toEqual(["wip"]);
			expect(index.factsOf(session).branch?.pullRequest).toBeNull();
			heading = { ...repo, number: 12 };
			await writeAt(70);
			expect(index.factsOf(session).branch?.pullRequest).toEqual({ ...repo, number: 12 });
			heading = null;
			await writeAt(100);
			expect(index.factsOf(session).branch?.pullRequest).toEqual({ ...repo, number: 12 });
			await writeAt(140);
			expect(asked).toEqual(["wip", "wip", "wip"]);
			expect(index.factsOf(session).branch?.pullRequest).toBeNull();
		} finally {
			setSystemTime();
		}
	});

	test("asks GitHub which PR a branch the list names none for heads once per branch, again a minute after the last ask even when it failed or answered, and when a gt submit finishes", async () => {
		const parent = realpathSync(sessionDir());
		await repoWithWorktrees(parent);
		const first = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const second = join(parent, "2026-10-01T00-00-00-000Z_s2.jsonl");
		writeFileSync(first, `${bashCall("b", "bun test")}\n`);
		writeFileSync(second, `${bashCall("b", "bun test")}\n`);
		const repo = { owner: "acme", repo: "webapp" };
		let answer = async (): Promise<{ owner: string; repo: string; number: number } | null> => null;
		const asked: string[] = [];
		const index = new SessionFactsIndex(async () => repo, new CachedCheckouts(), [], async (_, branch) => {
			asked.push(branch);
			return answer();
		});
		const start = Date.now();
		const writeAt = async (seconds: number, line: string) => {
			setSystemTime(new Date(start + seconds * 1000));
			appendFileSync(first, `${line}\n`);
			await index.refresh([
				{ path: first, cwd: join(parent, "app-wip"), modifiedAt: seconds + 1 },
				{ path: second, cwd: join(parent, "app-wip"), modifiedAt: 0 },
			]);
		};

		try {
			setSystemTime(new Date(start));
			await index.refresh([
				{ path: first, cwd: join(parent, "app-wip"), modifiedAt: 0 },
				{ path: second, cwd: join(parent, "app-wip"), modifiedAt: 0 },
			]);
			expect(asked).toEqual(["wip"]);
			await writeAt(30, bashCall("t", "bun test"));
			expect(asked).toEqual(["wip"]);
			answer = async () => {
				throw new Error("API rate limit exceeded");
			};
			await writeAt(60, bashCall("t", "bun test"));
			expect(asked).toEqual(["wip", "wip"]);
			answer = async () => ({ ...repo, number: 9 });
			await writeAt(70, bashCall("s", "gt submit --no-edit -q"));
			expect(asked).toEqual(["wip", "wip"]);
			await writeAt(80, result("s", ""));
			expect(asked).toEqual(["wip", "wip", "wip"]);
			expect(index.factsOf(first).branch?.pullRequest).toEqual({ ...repo, number: 9 });
			expect(index.factsOf(second).branch?.pullRequest).toEqual({ ...repo, number: 9 });
			await writeAt(100, bashCall("t", "bun test"));
			expect(asked).toEqual(["wip", "wip", "wip"]);
			await writeAt(200, bashCall("t", "bun test"));
			expect(asked).toEqual(["wip", "wip", "wip", "wip"]);
			expect(index.factsOf(first).branch?.pullRequest).toEqual({ ...repo, number: 9 });
		} finally {
			setSystemTime();
		}
	});

	test("names the branch a main checkout had checked out when the session last wrote, links the PR a non-default one heads as origin/HEAD moves, keeps it through later checkouts, and none on a detached HEAD", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		const start = Math.floor(Date.now() / 1000);
		const switchAt = (seconds: number, ...args: string[]) =>
			runChecked(["git", "-C", main, "switch", "-q", ...args], { env: { ...IDENTITY, GIT_COMMITTER_DATE: `${start + seconds} +0000` } });
		const setHead = async (branch: string) => {
			await git(main, "update-ref", `refs/remotes/origin/${branch}`, branch);
			await git(main, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`);
		};
		const earlier = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const later = join(parent, "2026-10-01T00-00-00-000Z_s2.jsonl");
		for (const path of [earlier, later]) writeFileSync(path, `${bashCall("b", "bun test")}\n`);
		const at = (seconds: number) => (start + seconds) * 1000;
		const repo = { owner: "acme", repo: "webapp" };
		const asked: string[] = [];
		const index = new SessionFactsIndex(
			async cwd => {
				asked.push(cwd);
				return repo;
			},
			new CachedCheckouts(),
		);

		await switchAt(10, "-c", "feature");
		expect(
			await index.refresh([
				{ path: earlier, cwd: main, modifiedAt: at(5) },
				{ path: later, cwd: main, modifiedAt: at(15) },
			]),
		).toBe(true);
		expect(index.learnHeads(repo, ["main", "feature"].map((head, i) => ({ ...repo, number: i + 1, head })))).toBe(false);
		expect(index.factsOf(later).branch).toEqual({ name: "feature", linked: false, defaultBranch: null, pullRequest: null });
		expect(asked).toEqual([]);

		await setHead("main");
		expect(
			await index.refresh([
				{ path: earlier, cwd: main, modifiedAt: at(5) + 1 },
				{ path: later, cwd: main, modifiedAt: at(15) },
			]),
		).toBe(true);
		expect(index.factsOf(earlier).branch).toEqual({ name: "main", linked: false, defaultBranch: "main", pullRequest: null });
		expect(index.factsOf(later).branch).toEqual({ name: "feature", linked: false, defaultBranch: "main", pullRequest: { ...repo, number: 2 } });
		expect([earlier, later].map(path => index.factsOf(path).pullRequests)).toEqual([[], [{ ...repo, number: 2, link: "worked" }]]);
		expect(asked).toEqual([main]);

		await setHead("feature");
		expect(
			await index.refresh([
				{ path: earlier, cwd: main, modifiedAt: at(5) + 2 },
				{ path: later, cwd: main, modifiedAt: at(15) },
			]),
		).toBe(true);
		const onMain = index.factsOf(earlier).branch;
		expect(onMain).toEqual({ name: "main", linked: false, defaultBranch: "feature", pullRequest: { ...repo, number: 1 } });
		expect(index.factsOf(later).branch).toEqual({ name: "feature", linked: false, defaultBranch: "feature", pullRequest: null });
		expect([earlier, later].map(path => index.factsOf(path).pullRequests)).toEqual([[{ ...repo, number: 1, link: "worked" }], []]);

		await switchAt(20, "--detach");
		expect(
			await index.refresh([
				{ path: earlier, cwd: main, modifiedAt: at(6) },
				{ path: later, cwd: main, modifiedAt: at(25) },
			]),
		).toBe(true);
		expect(index.factsOf(earlier).branch).toBe(onMain);
		expect(index.factsOf(later).branch).toBeNull();
		expect(
			await index.refresh([
				{ path: earlier, cwd: main, modifiedAt: at(7) },
				{ path: later, cwd: main, modifiedAt: at(25) },
			]),
		).toBe(false);
		expect(index.factsOf(earlier).branch).toBe(onMain);
	});

	test("keeps publishing the whole branch it knew while a refresh after a branch switch still asks git, then the new one whole", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		await git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
		await git(main, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
		const session = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		writeFileSync(session, `${bashCall("b", "bun test")}\n`);
		let gate: PromiseWithResolvers<null> | null = null;
		const asked = Promise.withResolvers<void>();
		const index = new SessionFactsIndex(
			() => {
				if (!gate) return Promise.resolve(null);
				asked.resolve();
				return gate.promise;
			},
			new CachedCheckouts(),
		);
		const listed = (modifiedAt: number) => [{ path: session, cwd: join(parent, "app-wip"), modifiedAt }];

		await index.refresh(listed(1));
		const before = index.factsOf(session).branch;
		expect(before).toEqual({ name: "wip", linked: true, defaultBranch: "main", pullRequest: null });

		await git(join(parent, "app-wip"), "switch", "-q", "-c", "next");
		gate = Promise.withResolvers<null>();
		const refreshed = index.refresh(listed(2));
		await asked.promise;
		expect(index.factsOf(session).branch).toBe(before);
		gate.resolve(null);
		expect(await refreshed).toBe(true);
		expect(index.factsOf(session).branch).toEqual({ name: "next", linked: true, defaultBranch: "main", pullRequest: null });
	});

	test("links the PR of the branch each gt submit submitted, printed or not, as checked out where and when it ran, and no dry run", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
		const start = Math.floor(Date.now() / 1000);
		const switchAt = (seconds: number, ...args: string[]) =>
			runChecked(["git", "-C", main, "switch", "-q", ...args], { env: { ...IDENTITY, GIT_COMMITTER_DATE: `${start + seconds} +0000` } });
		const submit = (id: string, seconds: number, command: string) =>
			JSON.stringify({
				type: "message",
				timestamp: new Date((start + seconds) * 1000).toISOString(),
				message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] },
			});
		await switchAt(10, "-c", "feature");
		await switchAt(30, "main");
		const session = join(parent, "2026-10-01T00-00-00-000Z_s1.jsonl");
		writeFileSync(
			session,
			`${[
				submit("quiet", 20, "gt submit --no-edit --no-stack -q 2>&1 | grep -v WARNING"),
				submit("elsewhere", 20, "cd ../app-wip && gt submit -q"),
				submit("dry", 40, "gt submit --dry-run"),
				submit("named", 40, "gt ss --branch done"),
			].join("\n")}\n`,
		);
		const repo = { owner: "acme", repo: "webapp" };
		const index = new SessionFactsIndex(async () => repo, new CachedCheckouts());

		await index.refresh([{ path: session, cwd: main, modifiedAt: 1 }]);
		index.learnHeads(repo, ["feature", "wip", "main", "done"].map((head, i) => ({ ...repo, number: i + 1, head })));
		expect(index.factsOf(session).pullRequests).toEqual([1, 2, 4].map(number => ({ ...repo, number, link: "submitted" })));
	});
});

describe("parseShipProgress", () => {
	test("keeps a known stage with the work, issue, and PR it names", () => {
		expect(parseShipProgress({ stage: "live", work: "fix_ci", issue: "ENG-1", pr: 7 })).toEqual({ stage: "live", work: "fix_ci", issue: "ENG-1", pr: 7 });
		expect(parseShipProgress({ stage: "ticket" })).toEqual({ stage: "ticket" });
	});

	test("drops a work, issue, or PR of the wrong kind but keeps the stage", () => {
		expect(parseShipProgress({ stage: "implement", work: "bogus", issue: 4, pr: 0 })).toEqual({ stage: "implement" });
		expect(parseShipProgress({ stage: "implement", pr: 1.5 })).toEqual({ stage: "implement" });
		expect(parseShipProgress({ stage: "implement", pr: -3 })).toEqual({ stage: "implement" });
	});

	test("is null without a known stage", () => {
		expect(parseShipProgress({ stage: "unknown" })).toBeNull();
		expect(parseShipProgress({ work: "rebase" })).toBeNull();
		expect(parseShipProgress("live")).toBeNull();
		expect(parseShipProgress(null)).toBeNull();
	});
});
