import { afterEach, expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isObject } from "./json";
import { newSessionRequest, parseNewSessionRequest } from "./shared/sessions";
import { TaskClaims, taskConflict, taskIdentity } from "./task-claims";
import { LiveSessions } from "./server/live-sessions";
import type { LiveSession } from "./live-session";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const claimsPath = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-task-"));
	dirs.push(dir);
	return join(dir, "claims.json");
};

test("explicit subjects, task identities, todos and command arguments identify work, not incidental prose", () => {
	const request = (prompt: string) => newSessionRequest("/repo", prompt);
	expect(taskIdentity(request("/ship ENG2650"))).toBe("ticket:ENG-2650");
	expect(taskIdentity(request("/ship ENG-2650"))).toBe("ticket:ENG-2650");
	expect(taskIdentity(request("https://linear.app/acme/issue/ENG-2650/fix-login"))).toBe("ticket:ENG-2650");
	expect(taskIdentity(request("/review https://github.com/ACME/App/pull/7"))).toBe("pr:acme/app#7");
	expect(taskIdentity(request("Explain why ENG-2650 used this design"))).toBeNull();
	for (const prose of ["S3 bucket policy is wrong", "EC2 instances leak", "ENG-2650 looks related"]) expect(taskIdentity(request(prose))).toBeNull();
	expect(taskIdentity(newSessionRequest("/repo", "work", { subject: { kind: "ticket", id: "ENG-2650" } }))).toBe("ticket:ENG-2650");
	expect(taskIdentity(newSessionRequest("/repo", "work", { subject: { kind: "pull-request", pr: { owner: "ACME", repo: "App", number: 7 } } }))).toBe("pr:acme/app#7");
	expect(taskIdentity(newSessionRequest("/repo", "work", { todoId: "t1" }))).toBe("todo:t1");
	expect(taskIdentity(newSessionRequest("/repo", "/ship ENG-2650", { taskId: "ENG-2650:read-only-review" }))).toBe("task:ENG-2650:read-only-review");
	expect(parseNewSessionRequest({ ...request("work"), taskId: "" })).toBeNull();
	expect(parseNewSessionRequest({ ...request("work"), taskId: "slice:tests" })?.ok.taskId).toBe("slice:tests");
});

test("two dashboard processes racing for one task publish exactly one owner", async () => {
	const path = claimsPath();
	const module = new URL("./task-claims.ts", import.meta.url).href;
	const code = `import { TaskClaims } from ${JSON.stringify(module)};
const claims = new TaskClaims(process.argv[1]);
const owner = claims.claim('/repo/.git', 'ticket:ENG-2650', String(process.pid), '/repo');
console.log(JSON.stringify({ conflict: owner !== null }));
await Bun.stdin.text();`;
	const children = [1, 2].map(() => Bun.spawn([process.execPath, "-e", code, path], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }));
	try {
		const results = await Promise.all(children.map(async child => {
			const reader = child.stdout.getReader();
			try {
				const first = await reader.read();
				const result: unknown = JSON.parse(new TextDecoder().decode(first.value));
				if (!isObject(result) || typeof result.conflict !== "boolean") throw new Error("The claim child returned no result.");
				return { conflict: result.conflict };
			} finally { reader.releaseLock(); }
		}));
		expect(results.filter(result => !result.conflict)).toHaveLength(1);
		expect(results.filter(result => result.conflict)).toHaveLength(1);
	} finally {
		for (const child of children) child.stdin.end();
		await Promise.all(children.map(child => child.exited));
	}
});

test("different tasks and repositories coexist, registry removal releases ownership, and another registry sees it", () => {
	const path = claimsPath();
	const firstClaims = new TaskClaims(path);
	const secondClaims = new TaskClaims(path);
	const first = new LiveSessions(() => {}, firstClaims);
	expect(firstClaims.claim("/repo/.git", "ticket:ENG-2650", "owner", "/repo/worktree")).toBeNull();
	expect(secondClaims.claim("/repo/.git", "ticket:ENG-2650", "duplicate", "/repo/other-worktree")?.instanceId).toBe("owner");
	expect(secondClaims.claim("/repo/.git", "ticket:ENG-2651", "other-task", "/repo/worktree")).toBeNull();
	expect(secondClaims.claim("/other/.git", "ticket:ENG-2650", "other-repo", "/other")).toBeNull();
	first.add(fromPartial<LiveSession>({ instanceId: "owner", sessionId: "s-owner", cwd: "/repo/worktree", finished: () => false }), null);
	first.remove("owner");
	expect(secondClaims.claim("/repo/.git", "ticket:ENG-2650", "replacement", "/repo/worktree")).toBeNull();
});

test("a surviving session or keeper retains its task across server restart; dead owners are reclaimed", () => {
	const path = claimsPath();
	const live = new Set([process.pid, 12345]);
	const first = new TaskClaims(path, pid => live.has(pid));
	first.claim("/repo/.git", "ticket:ENG-2650", "owner", "/repo");
	first.bind("owner", 12345, "s-owner", "/repo/worktree");
	live.delete(process.pid);
	const restarted = new TaskClaims(path, pid => live.has(pid));
	const conflict = restarted.claim("/repo/.git", "ticket:ENG-2650", "duplicate", "/repo");
	expect(conflict?.sessionId).toBe("s-owner");
	expect(conflict && taskConflict(conflict)).toContain("#session/s-owner");
	if (!conflict) throw new Error("The surviving owner must retain its claim.");
	const keeperPidFile = join(path, "..", "keeper.pid");
	writeFileSync(keeperPidFile, "54321");
	writeFileSync(path, JSON.stringify([{ ...conflict, keeperPidFile }]));
	live.delete(12345);
	live.add(54321);
	expect(restarted.claim("/repo/.git", "ticket:ENG-2650", "duplicate", "/repo")?.instanceId).toBe("owner");
	live.delete(54321);
	expect(restarted.claim("/repo/.git", "ticket:ENG-2650", "replacement", "/repo")).toBeNull();
});

test("corrupt owner state fails closed and is not silently replaced", () => {
	const path = claimsPath();
	writeFileSync(path, "not json");
	expect(() => new TaskClaims(path).claim("/repo/.git", "ticket:ENG-2650", "duplicate", "/repo")).toThrow();
	expect(readFileSync(path, "utf8")).toBe("not json");
});
