import { afterEach, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubAccess, GitHubQuotaError, quotaExhausted, quotaReset } from "./agent/extensions/github/access";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function directory(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-github-access-"));
	directories.push(dir);
	return dir;
}
const noReset = async () => undefined;

test("coalesces reads across module instances and caches only within the TTL", async () => {
	let now = 1000;
	const dir = directory();
	const first = new GitHubAccess(dir, () => now);
	const second = new GitHubAccess(dir, () => now);
	const load = mock(async () => ({ body: "The original" }));
	expect(await Promise.all([first.read("rest", "pr", load, noReset), second.read("rest", "pr", load, noReset)])).toEqual([{ body: "The original" }, { body: "The original" }]);
	expect(load).toHaveBeenCalledTimes(1);
	now += 5000;
	await second.read("rest", "pr", load, noReset);
	expect(load).toHaveBeenCalledTimes(2);
	expect(statSync(join(dir, "rest.json")).mode & 0o777).toBe(0o600);
});

test("fresh concurrency preflights bypass a cached body and never join a read in flight", async () => {
	const access = new GitHubAccess(directory(), () => 1000);
	const load = mock(async () => ({ body: "old" })).mockResolvedValueOnce({ body: "old" }).mockResolvedValueOnce({ body: "new" });
	await access.read("rest", "pr", load, noReset);
	expect(await access.read("rest", "pr", load, noReset, true)).toEqual({ body: "new" });
	expect(load).toHaveBeenCalledTimes(2);

	const { promise: answer, resolve } = Promise.withResolvers<{ body: string }>();
	const cachedRead = access.read("rest", "other", () => answer, noReset);
	const preflight = access.read("rest", "other", async () => ({ body: "newest" }), noReset, true);
	resolve({ body: "old" });
	expect(await cachedRead).toEqual({ body: "old" });
	expect(await preflight).toEqual({ body: "newest" });
});

test("different requests load concurrently, across instances, while sharing one state file", async () => {
	const dir = directory();
	const { promise: secondStarted, resolve } = Promise.withResolvers<void>();
	const first = new GitHubAccess(dir).read("rest", "first", async () => { await secondStarted; return "first"; }, noReset);
	const second = new GitHubAccess(dir).read("rest", "second", async () => { resolve(); return "second"; }, noReset);
	expect(await Promise.all([first, second])).toEqual(["first", "second"]);
});

test.each(["graphql", "rest"] as const)("%s exhaustion is shared until its reported reset, without blocking the other budget", async budget => {
	let now = 1000;
	const dir = directory();
	const first = new GitHubAccess(dir, () => now);
	const second = new GitHubAccess(dir, () => now);
	const refused = mock(async () => { throw new Error("API rate limit exceeded"); });
	const reset = mock(async () => 10_000);
	await expect(first.read(budget, "one", refused, reset)).rejects.toBeInstanceOf(GitHubQuotaError);
	const request = mock(async () => "fresh");
	await expect(second.read(budget, "two", request, reset)).rejects.toThrow("1970-01-01T00:00:10.000Z");
	expect(request).not.toHaveBeenCalled();
	expect(refused).toHaveBeenCalledTimes(1);
	expect(reset).toHaveBeenCalledTimes(1);
	expect(await second.read(budget === "graphql" ? "rest" : "graphql", "two", request, noReset)).toBe("fresh");
	now = 10_000;
	expect(await second.read(budget, "two", request, reset)).toBe("fresh");
});

test("authentication refusal is not quota exhaustion and is never cached", async () => {
	const access = new GitHubAccess(directory());
	const load = mock(async () => { throw new Error("HTTP 401: Bad credentials"); });
	const reset = mock(noReset);
	for (let i = 0; i < 2; i++) await expect(access.read("graphql", "pr", load, reset)).rejects.toThrow("Bad credentials");
	expect(load).toHaveBeenCalledTimes(2);
	expect(reset).not.toHaveBeenCalled();
	expect(quotaExhausted(new Error("HTTP 403: Resource not accessible by integration"))).toBe(false);
});

test("a failed command's GraphQL errors beside partial data are quota failures, not cached fresh data", async () => {
	const access = new GitHubAccess(directory());
	const stdout = JSON.stringify({ data: { repository: null }, errors: [{ type: "RATE_LIMITED", message: "Too many requests" }] });
	await expect(access.read("graphql", "pr", async () => { throw Object.assign(new Error("gh exited 1"), { stdout }); }, async () => Date.now() + 120_000)).rejects.toThrow("No fresh data was read");
	const load = mock(async () => "stale");
	await expect(access.read("graphql", "pr", load, noReset)).rejects.toThrow("quota exhausted");
	expect(load).not.toHaveBeenCalled();
});

test("successful and refused mutations invalidate both read budgets without retrying", async () => {
	const access = new GitHubAccess(directory());
	const rest = mock(async () => "rest");
	const graphql = mock(async () => "graphql");
	for (const fail of [false, true]) {
		await access.read("rest", "pr", rest, noReset);
		await access.read("graphql", "pr", graphql, noReset);
		const mutation = mock(async () => { if (fail) throw new Error("refused"); return "changed"; });
		if (fail) await expect(access.write("rest", mutation, noReset)).rejects.toThrow("refused");
		else expect(await access.write("rest", mutation, noReset)).toBe("changed");
		expect(mutation).toHaveBeenCalledTimes(1);
	}
	await access.read("rest", "pr", rest, noReset);
	await access.read("graphql", "pr", graphql, noReset);
	expect(rest).toHaveBeenCalledTimes(3);
	expect(graphql).toHaveBeenCalledTimes(3);
});

test("a successful answer is data, even when its text discusses a quota incident", async () => {
	expect(quotaExhausted({ body: "API rate limit exceeded erased the old description." })).toBe(false);
	expect(quotaExhausted({ data: { repository: { pullRequest: { body: "RATE_LIMITED" } } } })).toBe(false);
	const access = new GitHubAccess(directory());
	const reset = mock(noReset);
	const saved = "API rate limit exceeded: GraphQL quota exhausted erased the old description.";
	expect(await access.write("rest", async () => saved, reset)).toBe(saved);
	expect(await access.read("rest", "pr", async () => saved, reset)).toBe(saved);
	expect(await access.read("rest", "next", async () => "available", reset)).toBe("available");
	expect(reset).not.toHaveBeenCalled();
});

test("the free metadata probe selects each budget's reset, only once that window is spent", () => {
	const answer = { resources: { core: { remaining: 0, reset: 12 }, graphql: { remaining: 0, reset: 34 } } };
	expect(quotaReset(answer, "rest")).toBe(12_000);
	expect(quotaReset(answer, "graphql")).toBe(34_000);
	// A secondary limit refuses requests while the window still has quota; its far reset is not the wait.
	expect(quotaReset({ resources: { core: { remaining: 4000, reset: 12 } } }, "rest")).toBeUndefined();
});

test("separate processes coalesce a read while holding real interprocess ownership", async () => {
	const dir = directory();
	const source = `
		import { appendFileSync } from 'node:fs';
		import { join } from 'node:path';
		// The child loads the caller-selected module; no static import is possible in this stdin program.
		const { GitHubAccess } = await import(process.argv[2]);
		const dir = process.argv[3];
		const access = new GitHubAccess(dir);
		const value = await access.read('rest', 'same-request', async () => {
			appendFileSync(join(dir, 'requests'), 'request\\n');
			// Real OS processes need to overlap their network slot; parent fake timers cannot reach them.
			await Bun.sleep(100);
			return { title: 'Shared read' };
		}, async () => undefined);
		console.log(JSON.stringify(value));
	`;
	const children = [0, 1].map(() => Bun.spawn([process.execPath, "run", "-", join(import.meta.dir, "agent/extensions/github/access.ts"), dir], { stdin: new Blob([source]), stdout: "pipe", stderr: "pipe" }));
	for (const child of children) {
		const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		expect(err).toBe("");
		expect(code).toBe(0);
		expect(JSON.parse(out)).toEqual({ title: "Shared read" });
	}
	expect(readFileSync(join(dir, "requests"), "utf8")).toBe("request\n");
});
