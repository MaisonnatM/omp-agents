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
type Space = "personal" | "work";

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	servicesOf(mcp: object, accounts: { addresses: Record<string, string>; personal: string[] }): ServiceAccounts[];
	placeOf(cwd: string): Place;
	spaceOf(place: Place, personal: readonly string[], personalDir: string): Space;
	accountsText(services: readonly ServiceAccounts[], space: Space, personal: readonly string[]): string | null;
} = await import(join(import.meta.dir, "agent/extensions/google-accounts.ts"));
const { accountsText, placeOf, servicesOf, spaceOf } = extension;

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
	const personalDir = join(root, "personal");

	test("a linked worktree outside its repository is in the space of its main checkout, by real path", () => {
		const place = placeOf(join(worktree, "src"));
		expect(place).toEqual({ dir: join(real, "repo-feature", "src"), main: join(real, "repo") });
		expect(spaceOf(place, [repo], personalDir)).toBe("personal");
		expect(spaceOf(place, [join(real, "repo")], personalDir)).toBe("personal");
		expect(spaceOf(place, [worktree], personalDir)).toBe("work");
	});

	test("a directory of the main checkout is in a space only as the workspace it is named as", () => {
		expect(spaceOf(placeOf(repo), [repo], personalDir)).toBe("personal");
		expect(spaceOf(placeOf(join(repo, "web")), [join(repo, "web")], personalDir)).toBe("personal");
		expect(spaceOf(placeOf(join(repo, "web")), [repo], personalDir)).toBe("work");
	});

	test("the personal directory is Personal, and a directory outside git only when it is listed", () => {
		const place = placeOf(join(root, "plain"));
		expect(place).toEqual({ dir: join(real, "plain"), main: null });
		expect(spaceOf(place, [], join(root, "plain"))).toBe("personal");
		expect(spaceOf(place, [repo], personalDir)).toBe("work");
		expect(spaceOf(place, [join(root, "plain")], personalDir)).toBe("personal");
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
			{ addresses: { gmail: "ana@example.com", "google-calendar": "ana@example.com" }, personal: [] },
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

	test("one account per service tells nothing, in either space", () => {
		expect(accountsText(one, "work", [])).toBeNull();
		expect(accountsText(one, "personal", ["ana@example.com"])).toBeNull();
	});

	test("two accounts on a service list that service's accounts and their tool prefixes, with nothing to prefer while every account is in one space", () => {
		expect(accountsText(two, "work", [])).toBe(listing);
		expect(accountsText(two, "personal", [])).toBe(listing);
		expect(accountsText(two, "personal", ["ana@example.com", "ana@work.example"])).toBe(listing);
		expect(accountsText(two, "work", ["bo@example.com"])).toBe(listing);
	});

	test("a session says to use the accounts placed in its space for its mail and calendar", () => {
		expect(accountsText(two, "personal", ["ana@example.com"])).toBe(
			`${listing}\nThis session is in the user's Personal space, and the user placed ana@example.com in it: use that account for this session's mail and calendar unless the user names another account.`,
		);
		expect(accountsText(two, "work", ["ana@example.com"])).toBe(
			`${listing}\nThis session is in the user's Work space, and the user placed ana@work.example in it: use that account for this session's mail and calendar unless the user names another account.`,
		);
		expect(accountsText([{ label: "Gmail", accounts: [...two[0]!.accounts, { server: "gmail-3", address: "bo@example.com" }] }], "work", ["ana@example.com"])).toBe(
			`${listing}\n- gmail-3: bo@example.com, tools \`mcp__gmail_3_\`\nThis session is in the user's Work space, and the user placed ana@work.example, bo@example.com in it: use those accounts for this session's mail and calendar unless the user names another account.`,
		);
	});
});
