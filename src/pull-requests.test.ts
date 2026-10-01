import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PullRequestIndex, SubmissionScan } from "./pull-requests";

const bashCall = (id: string, command: string) =>
	JSON.stringify({
		type: "message",
		message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] },
	});
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

const scanned = (lines: string[]) => {
	const scan = new SubmissionScan();
	for (const line of lines) scan.applyLine(line);
	return [...scan.found.values()];
};

describe("SubmissionScan", () => {
	test("every branch a gt submit created or updated, once each", () => {
		const output = [
			"🥞 Pushing to remote and creating/updating PRs for stack...",
			"me/a: https://app.graphite.com/github/pr/acme/webapp/6595 (updated)",
			"me/b: https://app.graphite.com/github/pr/acme/webapp/6596 (created)",
		].join("\n");
		expect(scanned([bashCall("c1", "gt submit --stack"), result("c1", output), result("c2", output)])).toEqual([
			{ owner: "acme", repo: "webapp", number: 6595 },
			{ owner: "acme", repo: "webapp", number: 6596 },
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
		).toEqual([{ owner: "acme", repo: "webapp", number: 6600 }]);
	});

	test("a background gt submit's output, whether delivered or waited for", () => {
		expect(scanned([delivered("bg_1", `Background job bg_1 has completed.\n${gtLine(1)}`), waited([{ id: "bg_2", type: "bash", resultText: gtLine(2) }])])).toEqual([
			{ owner: "o", repo: "r", number: 1 },
			{ owner: "o", repo: "r", number: 2 },
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
		).toEqual([{ owner: "o", repo: "r", number: 3 }]);
	});

	test("a gt submit line a subagent's report quotes is a mention, not a submission", () => {
		expect(scanned([waited([{ id: "Reviewer", type: "task", resultText: `e.g.\n${gtLine(4)}` }])])).toEqual([]);
	});
});

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("PullRequestIndex", () => {
	test("folds in subagents' submissions and picks up appends once the session file changes", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-prs-"));
		dirs.push(dir);
		const session = join(dir, "2026-10-01T00-00-00-000Z_s1.jsonl");
		const submitted = (n: number) => result(`r${n}`, gtLine(n));
		writeFileSync(session, `${submitted(1)}\n`);
		mkdirSync(join(dir, "2026-10-01T00-00-00-000Z_s1", "Child"), { recursive: true });
		writeFileSync(join(dir, "2026-10-01T00-00-00-000Z_s1", "Child", "Grandchild.jsonl"), `${submitted(2)}\n`);

		const index = new PullRequestIndex();
		expect(await index.refresh([{ path: session, modifiedAt: 1 }])).toBe(true);
		expect(index.of(session).map(pr => pr.number)).toEqual([1, 2]);

		appendFileSync(session, `${submitted(3)}\n${submitted(4).slice(0, 20)}`);
		expect(await index.refresh([{ path: session, modifiedAt: 1 }])).toBe(false);
		expect(index.of(session).map(pr => pr.number)).toEqual([1, 2]);
		expect(await index.refresh([{ path: session, modifiedAt: 2 }])).toBe(true);
		expect(index.of(session).map(pr => pr.number)).toEqual([1, 3, 2]);

		expect(await index.refresh([])).toBe(false);
		expect(index.of(session)).toEqual([]);
	});
});
