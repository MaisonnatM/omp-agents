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
const result = (toolCallId: string, text: string, toolName = "bash") =>
	JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }] } });

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

	test("a gt submit line quoted outside bash output is a mention, not a submission", () => {
		const quoted = "e.g. me/a: https://app.graphite.com/github/pr/acme/webapp/6596 (updated)\nme/a: https://app.graphite.com/github/pr/acme/webapp/6596 (updated)";
		expect(scanned([result("w1", quoted, "wait")])).toEqual([]);
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
		const gtLine = (n: number) => result(`r${n}`, `me/b${n}: https://app.graphite.com/github/pr/o/r/${n} (created)`);
		writeFileSync(session, `${gtLine(1)}\n`);
		mkdirSync(join(dir, "2026-10-01T00-00-00-000Z_s1", "Child"), { recursive: true });
		writeFileSync(join(dir, "2026-10-01T00-00-00-000Z_s1", "Child", "Grandchild.jsonl"), `${gtLine(2)}\n`);

		const index = new PullRequestIndex();
		expect(await index.refresh([{ path: session, modifiedAt: 1 }])).toBe(true);
		expect(index.of(session).map(pr => pr.number)).toEqual([1, 2]);

		appendFileSync(session, `${gtLine(3)}\n${gtLine(4).slice(0, 20)}`);
		expect(await index.refresh([{ path: session, modifiedAt: 1 }])).toBe(false);
		expect(index.of(session).map(pr => pr.number)).toEqual([1, 2]);
		expect(await index.refresh([{ path: session, modifiedAt: 2 }])).toBe(true);
		expect(index.of(session).map(pr => pr.number)).toEqual([1, 3, 2]);

		expect(await index.refresh([])).toBe(false);
		expect(index.of(session)).toEqual([]);
	});
});
