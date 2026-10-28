import { afterEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cooldownDirectory, GitHubAccess, GitHubQuotaError, quotaExhausted, quotaReset } from "./agent/extensions/github/access";
import { CommandError, ghJson, ghText } from "./agent/extensions/github/command";

const directories: string[] = [];
afterEach(() => {
	mock.restore();
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-github-access-"));
	directories.push(dir);
	return dir;
}
const noReset = async () => undefined;

test.each(["graphql", "rest"] as const)("%s exhaustion fails fast in another instance until its reported reset, without blocking the other budget", async budget => {
	let now = 1000;
	const dir = directory();
	const first = new GitHubAccess(dir, () => now);
	const second = new GitHubAccess(dir, () => now);
	const refused = mock(async () => { throw new Error("API rate limit exceeded"); });
	const reset = mock(async () => 10_000);
	await expect(first.request(budget, refused, reset)).rejects.toBeInstanceOf(GitHubQuotaError);
	const load = mock(async () => "answer");
	await expect(second.request(budget, load, reset)).rejects.toThrow("1970-01-01T00:00:10.000Z");
	expect(load).not.toHaveBeenCalled();
	expect(refused).toHaveBeenCalledTimes(1);
	expect(reset).toHaveBeenCalledTimes(1);
	expect(statSync(join(dir, `${budget}.json`)).mode & 0o777).toBe(0o600);
	expect(await second.request(budget === "graphql" ? "rest" : "graphql", load, noReset)).toBe("answer");
	now = 10_000;
	expect(await second.request(budget, load, reset)).toBe("answer");
});

test("a refusal without a spent window pauses the budget for a minute", async () => {
	let now = 1000;
	const access = new GitHubAccess(directory(), () => now);
	const reset = async () => quotaReset({ resources: { core: { remaining: 4000, reset: 999_999 } } }, "rest");
	await expect(access.request("rest", async () => { throw new Error("You have exceeded a secondary rate limit"); }, reset)).rejects.toThrow("1970-01-01T00:01:01.000Z");
	const load = mock(async () => "answer");
	now = 60_999;
	await expect(access.request("rest", load, noReset)).rejects.toBeInstanceOf(GitHubQuotaError);
	expect(load).not.toHaveBeenCalled();
	now = 61_000;
	expect(await access.request("rest", load, noReset)).toBe("answer");
});

test("authentication refusal is not quota exhaustion and leaves the budget open", async () => {
	const access = new GitHubAccess(directory());
	const load = mock(async () => { throw new CommandError("HTTP 401: Bad credentials", { message: "Bad credentials" }); });
	const reset = mock(noReset);
	for (let i = 0; i < 2; i++) await expect(access.request("graphql", load, reset)).rejects.toThrow("Bad credentials");
	expect(load).toHaveBeenCalledTimes(2);
	expect(reset).not.toHaveBeenCalled();
	expect(quotaExhausted(new Error("HTTP 403: Resource not accessible by integration"))).toBe(false);
});

test("a failed command's RATE_LIMITED error beside partial data on stdout is a quota failure", async () => {
	const access = new GitHubAccess(directory());
	const stdout = JSON.stringify({ data: { repository: null }, errors: [{ type: "RATE_LIMITED", message: "Too many requests" }] });
	const gh = async () => ({ code: 1, stdout, stderr: "" });
	await expect(access.request("graphql", () => ghJson(gh, ["api", "graphql"]), async () => Date.now() + 120_000)).rejects.toThrow("No fresh data was read");
	const load = mock(async () => "stale");
	await expect(access.request("graphql", load, noReset)).rejects.toThrow("GraphQL quota exhausted");
	expect(load).not.toHaveBeenCalled();
});

test("a successful answer is data, even when its text discusses a quota incident", async () => {
	expect(quotaExhausted({ body: "API rate limit exceeded erased the old description." })).toBe(false);
	expect(quotaExhausted({ data: { repository: { pullRequest: { body: "RATE_LIMITED" } } } })).toBe(false);
	const access = new GitHubAccess(directory());
	const reset = mock(noReset);
	const saved = "API rate limit exceeded: GraphQL quota exhausted erased the old description.";
	const gh = async () => ({ code: 0, stdout: saved, stderr: "warning: API rate limit exceeded soon" });
	expect(await access.request("rest", () => ghText(gh, ["api", "repos/acme/app/pulls/7"]), reset)).toBe(saved);
	expect(await access.request("rest", async () => "available", reset)).toBe("available");
	expect(reset).not.toHaveBeenCalled();
});

test("the free metadata probe selects each budget's reset, only once that window is spent", () => {
	const answer = { resources: { core: { remaining: 0, reset: 12 }, graphql: { remaining: 0, reset: 34 } } };
	expect(quotaReset(answer, "rest")).toBe(12_000);
	expect(quotaReset(answer, "graphql")).toBe(34_000);
	// A secondary limit refuses requests while the window still has quota; its far reset is not the wait.
	expect(quotaReset({ resources: { core: { remaining: 4000, reset: 12 } } }, "rest")).toBeUndefined();
});

test("a cooldown another process recorded fails fast here without loading", async () => {
	const dir = directory();
	const source = `
		// The child loads the caller-selected module; no static import is possible in this stdin program.
		const { GitHubAccess } = await import(process.argv[2]);
		const access = new GitHubAccess(process.argv[3]);
		await access.request('graphql', async () => { throw new Error('API rate limit exceeded'); }, async () => Date.now() + 3_600_000).catch(error => console.log(error.constructor.name));
	`;
	const child = Bun.spawn([process.execPath, "run", "-", join(import.meta.dir, "agent/extensions/github/access.ts"), dir], { stdin: new Blob([source]), stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(err).toBe("");
	expect(code).toBe(0);
	expect(out.trim()).toBe("GitHubQuotaError");
	const load = mock(async () => "answer");
	await expect(new GitHubAccess(dir).request("graphql", load, noReset)).rejects.toBeInstanceOf(GitHubQuotaError);
	expect(load).not.toHaveBeenCalled();
});

test("without a rejected token, cooldowns are those of the stored login gh falls back to", async () => {
	const saved = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, GH_HOST: process.env.GH_HOST };
	const config = directory();
	await Bun.write(join(config, "gh", "hosts.yml"), "github.com:\n    user: octocat\n");
	Object.assign(process.env, { XDG_CONFIG_HOME: config, GH_CONFIG_DIR: join(config, "gh") });
	delete process.env.GH_TOKEN;
	delete process.env.GH_HOST;
	try {
		delete process.env.GITHUB_TOKEN;
		await expect(new GitHubAccess(undefined, () => 1000).request("graphql", async () => { throw new Error("API rate limit exceeded"); }, async () => 10_000)).rejects.toBeInstanceOf(GitHubQuotaError);
		process.env.GITHUB_TOKEN = "ghp_rejected";
		const load = mock(async () => "answer");
		expect(await new GitHubAccess(undefined, () => 1000).request("graphql", load, noReset)).toBe("answer");
		await expect(new GitHubAccess(cooldownDirectory(["GITHUB_TOKEN"]), () => 1000).request("graphql", load, noReset)).rejects.toThrow("1970-01-01T00:00:10.000Z");
		expect(load).toHaveBeenCalledTimes(1);
	} finally {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
});
