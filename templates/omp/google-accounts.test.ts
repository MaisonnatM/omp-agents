import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Account {
	server: string;
	address: string | null;
}
interface ServiceAccounts {
	label: string;
	accounts: Account[];
}
interface Place {
	dir: string;
	main: string | null;
}

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	servicesOf(mcp: object, accounts: { addresses: Record<string, string>; links: Record<string, string[]> }): ServiceAccounts[];
	placeOf(cwd: string): Place;
	workspaceOf(place: Place, workspaces: readonly string[]): string | null;
	accountsText(services: readonly ServiceAccounts[], workspace: { dir: string; addresses: readonly string[] } | null): string | null;
} = await import(join(import.meta.dir, "agent/extensions/google-accounts.ts"));
const { accountsText, placeOf, servicesOf, workspaceOf } = extension;

const GMAIL = "https://gmailmcp.googleapis.com/mcp/v1";
const CALENDAR = "https://calendarmcp.googleapis.com/mcp/v1";

describe("google-accounts extension", () => {
	// Under the system temp directory, which on macOS is a symlink, so the workspaces below are named by a path that is not real.
	const root = mkdtempSync(join(tmpdir(), "google-accounts-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const real = realpathSync(root);
	const repo = join(root, "repo");
	const worktree = join(root, "repo-feature");
	const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "ignore" });
	mkdirSync(join(repo, "web"), { recursive: true });
	git("init", "-q");
	git("commit", "-q", "--allow-empty", "-m", "start");
	git("worktree", "add", "-q", "-b", "feature", worktree);
	mkdirSync(join(worktree, "src"));
	mkdirSync(join(root, "plain"));

	test("a linked worktree outside its repository belongs to the workspace of its main checkout, by real path", () => {
		const place = placeOf(join(worktree, "src"));
		expect(place).toEqual({ dir: join(real, "repo-feature", "src"), main: join(real, "repo") });
		expect(workspaceOf(place, [repo])).toBe(repo);
		expect(workspaceOf(place, [join(real, "repo")])).toBe(join(real, "repo"));
	});

	test("the deepest workspace wins, and the session's own directory before its main checkout", () => {
		expect(workspaceOf(placeOf(join(repo, "web")), [root, repo])).toBe(repo);
		expect(workspaceOf(placeOf(join(repo, "web")), [repo, root])).toBe(repo);
		expect(workspaceOf(placeOf(join(worktree, "src")), [repo, worktree])).toBe(worktree);
		expect(workspaceOf(placeOf(repo), [join(repo, "web")])).toBeNull();
	});

	test("a directory outside git has no main checkout and matches only a workspace it is in", () => {
		const place = placeOf(join(root, "plain"));
		expect(place).toEqual({ dir: join(real, "plain"), main: null });
		expect(workspaceOf(place, [repo])).toBeNull();
		expect(workspaceOf(place, [root])).toBe(root);
		expect(workspaceOf({ dir: join(real, "repository"), main: null }, [repo])).toBeNull();
	});

	test("each Google service's accounts are its enabled servers on its host, with their learned addresses", () => {
		const services = servicesOf(
			{
				disabledServers: ["gmail-3"],
				mcpServers: {
					gmail: { type: "http", url: GMAIL },
					linear: { type: "http", url: "https://mcp.linear.app/mcp" },
					"Gmail Work": { type: "http", url: GMAIL },
					"gmail-3": { type: "http", url: GMAIL },
					"gmail-4": { type: "http", url: GMAIL, enabled: false },
					"google-calendar": { type: "http", url: CALENDAR },
				},
			},
			{ addresses: { gmail: "ana@example.com", "google-calendar": "ana@example.com" }, links: {} },
		);
		expect(services).toEqual([
			{
				label: "Gmail",
				accounts: [
					{ server: "gmail", address: "ana@example.com" },
					{ server: "Gmail Work", address: null },
				],
			},
			{ label: "Google Calendar", accounts: [{ server: "google-calendar", address: "ana@example.com" }] },
		]);
	});

	const one: ServiceAccounts[] = [
		{ label: "Gmail", accounts: [{ server: "gmail", address: "ana@example.com" }] },
		{ label: "Google Calendar", accounts: [{ server: "google-calendar", address: "ana@example.com" }] },
	];
	const two: ServiceAccounts[] = [
		{
			label: "Gmail",
			accounts: [
				{ server: "gmail", address: "ana@example.com" },
				{ server: "gmail-2", address: "ana@work.example" },
				{ server: "Gmail Work", address: null },
			],
		},
		{ label: "Google Calendar", accounts: [{ server: "google-calendar", address: "ana@example.com" }] },
	];
	const listing = [
		"omp is signed in to several Google accounts, one MCP server each, and each server's tools start with its prefix.",
		"Gmail:",
		"- gmail: ana@example.com, tools `mcp__gmail_`",
		"- gmail-2: ana@work.example, tools `mcp__gmail_2_`",
		"- Gmail Work: address not known yet, tools `mcp__gmail_work_`",
	].join("\n");

	test("one account per service tells nothing, even in a linked workspace", () => {
		expect(accountsText(one, null)).toBeNull();
		expect(accountsText(one, { dir: "/code/work", addresses: ["ana@example.com"] })).toBeNull();
	});

	test("two accounts on a service list that service's accounts and their tool prefixes", () => {
		expect(accountsText(two, null)).toBe(listing);
		expect(accountsText(two, { dir: "/code/work", addresses: ["bo@example.com"] })).toBe(listing);
	});

	test("a workspace linked to listed addresses says to use those for its mail and calendar", () => {
		expect(accountsText(two, { dir: "/code/work", addresses: ["ana@work.example", "bo@example.com"] })).toBe(
			`${listing}\nThe user linked this workspace, /code/work, to ana@work.example: use that account for this workspace's mail and calendar unless the user names another account.`,
		);
		expect(accountsText(two, { dir: "/code/work", addresses: ["ana@example.com", "ana@work.example"] })).toBe(
			`${listing}\nThe user linked this workspace, /code/work, to ana@example.com, ana@work.example: use those accounts for this workspace's mail and calendar unless the user names another account.`,
		);
	});
});
