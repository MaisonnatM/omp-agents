import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeAt } from "./git";
import { runChecked } from "./proc";
import { parseShipProgress, resolveLinks, SessionFactsIndex, SessionFactsScan } from "./session-facts";

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

const scanned = (lines: string[]) => {
	const scan = new SessionFactsScan();
	for (const line of lines) scan.applyLine(line);
	return [...scan.found.values()];
};

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

	test("an omp pr:// read names its PR, with or without its repository", () => {
		expect(
			scanned([
				toolCall("r1", "read", { path: "pr://6605/diff/all" }),
				toolCall("r2", "read", { path: "pr://acme/api/9?comments=1" }),
				toolCall("r3", "read", { path: "pr://" }),
				toolCall("r4", "read", { path: "issue://6606" }),
			]),
		).toEqual([{ kind: "number", number: 6605 }, worked("acme", "api", 9)]);
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
			{ kind: "branch", owner: "acme", repo: "webapp", branch: "me/feature" },
			{ kind: "branch", owner: "acme", repo: "webapp", branch: "me/forced" },
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

	test("the Linear issues a session read, changed, opened, or commented on, but not one a search listed", () => {
		const device = (id: string, tool: string, args: object) => toolCall(id, "write", { path: `xd://mcp__linear_${tool}`, content: JSON.stringify(args) });
		const answered = (toolCallId: string, text: string, isError = false) =>
			JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId, toolName: "write", isError, content: [{ type: "text", text }] } });
		const scan = new SessionFactsScan();
		for (const line of [
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
		]) scan.applyLine(line);
		expect([...scan.tickets]).toEqual(["ENG-2", "ENG-3", "ENG-4", "ENG-6"]);
	});
});

describe("resolveLinks", () => {
	const heads = new Map([["acme/webapp:me/feature", { owner: "acme", repo: "webapp", number: 6610 }]]);

	test("a bare number is in the session's repository and a pushed branch is the PR it heads", () => {
		expect(
			resolveLinks(
				[
					{ kind: "number", number: 6609 },
					{ kind: "branch", owner: "Acme", repo: "WebApp", branch: "me/feature" },
					{ kind: "branch", owner: "acme", repo: "webapp", branch: "me/no-pr" },
				],
				{ owner: "acme", repo: "webapp" },
				heads,
			),
		).toEqual([
			{ owner: "acme", repo: "webapp", number: 6609, link: "worked" },
			{ owner: "acme", repo: "webapp", number: 6610, link: "worked" },
		]);
	});

	test("without a repository a bare number links nowhere, and one PR found twice keeps the submission", () => {
		expect(
			resolveLinks(
				[{ kind: "number", number: 1 }, { kind: "branch", owner: "acme", repo: "webapp", branch: "me/feature" }, submitted("ACME", "webapp", 6610)],
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

		const index = new SessionFactsIndex(async () => null, async () => null);
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
		const index = new SessionFactsIndex(async () => null, async () => null);
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

	test("lists the session's Linear issues before its subagents', each once, and reports a new one on append", async () => {
		const dir = sessionDir();
		const session = join(dir, "2026-10-01T00-00-00-000Z_tickets.jsonl");
		const read = (id: string) => toolCall(`get-${id}`, "mcp__linear_get_issue", { id });
		writeFileSync(session, `${read("ENG-1")}\n`);
		const child = join(dir, "2026-10-01T00-00-00-000Z_tickets");
		mkdirSync(child, { recursive: true });
		writeFileSync(join(child, "Sub.jsonl"), `${read("ENG-2")}\n${read("ENG-1")}\n`);
		const index = new SessionFactsIndex(async () => null, async () => null);
		const listed = (modifiedAt: number) => [{ path: session, cwd: dir, modifiedAt }];

		expect(await index.refresh(listed(1))).toBe(true);
		expect(index.factsOf(session).tickets).toEqual(["ENG-1", "ENG-2"]);
		appendFileSync(session, `${read("ENG-1")}\n`);
		expect(await index.refresh(listed(2))).toBe(false);
		appendFileSync(session, `${read("ENG-3")}\n`);
		expect(await index.refresh(listed(3))).toBe(true);
		expect(index.factsOf(session).tickets).toEqual(["ENG-1", "ENG-3", "ENG-2"]);
	});

	test("asks for the repository only of sessions that name a bare number, and links pushes once the inbox names their PR", async () => {
		const dir = sessionDir();
		const reader = join(dir, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const pusher = join(dir, "2026-10-01T00-00-00-000Z_s2.jsonl");
		writeFileSync(reader, `${toolCall("r", "read", { path: "pr://6611" })}\n`);
		writeFileSync(pusher, `${bashCall("p", "git push")}\n${result("p", pushed("me/feature"))}\n`);
		const asked: string[] = [];
		const index = new SessionFactsIndex(
			async cwd => {
				asked.push(cwd);
				return { owner: "acme", repo: "webapp" };
			},
			async () => null,
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

		const inbox = [{ owner: "acme", repo: "webapp", number: 6612, head: "me/feature" }];
		expect(index.learnHeads({ owner: "acme", repo: "webapp" }, inbox)).toBe(true);
		expect(index.factsOf(pusher).pullRequests).toEqual([{ owner: "acme", repo: "webapp", number: 6612, link: "worked" }]);
		expect(index.learnHeads({ owner: "acme", repo: "webapp" }, inbox)).toBe(false);
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
		const index = new SessionFactsIndex(async () => null, worktreeAt);
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

	test("links the PR that heads the branch of the linked worktree a session works in, not the main checkout's, and follows a branch switch", async () => {
		const parent = realpathSync(sessionDir());
		const main = await repoWithWorktrees(parent);
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
		const index = new SessionFactsIndex(async () => repo, worktreeAt);

		await index.refresh(listed(1));
		expect(index.learnHeads(repo, heads)).toBe(true);
		expect(index.factsOf(inWorktree).pullRequests).toEqual(linked(1));
		expect(index.factsOf(intoWorktree).pullRequests).toEqual(linked(2));
		expect(index.factsOf(inMain).pullRequests).toEqual([]);

		await git(join(parent, "app-wip"), "switch", "-q", "-c", "next");
		await git(join(parent, "app-done"), "switch", "-q", "--detach");
		appendFileSync(inWorktree, `${ran(".")}\n`);
		appendFileSync(intoWorktree, `${ran(join(parent, "app-done"))}\n`);
		expect(await index.refresh(listed(2))).toBe(true);
		expect(index.factsOf(inWorktree).pullRequests).toEqual(linked(4));
		expect(index.factsOf(intoWorktree).pullRequests).toEqual([]);

		const offGitHub = new SessionFactsIndex(async () => null, worktreeAt);
		await offGitHub.refresh(listed(1));
		offGitHub.learnHeads(repo, heads);
		expect(offGitHub.factsOf(inWorktree).pullRequests).toEqual([]);
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
