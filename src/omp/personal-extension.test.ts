import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecked } from "../proc";
import { log, STATE } from "../sport-fixtures";
import { loadExtension } from "./fake-extension-api";
import personalExtension, { PERSONAL_FLAGS } from "./personal-extension";

const dirs: string[] = [];
afterEach(() => {
	setSystemTime();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", "-C", cwd, ...args], { env: IDENTITY });

/**
 * The extension loaded as the dashboard loads it into every session, with a personal directory, and a workspaces file, a
 * Google accounts file, a memory file and a sport file that do not exist yet; `flags` leaves out the sport flags, the
 * memory and sport flags as for a Bot's conversation, or every flag.
 */
function loadedPersonal(flags: "all" | "memory" | "bot" | "none" = "all") {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-personal-")));
	dirs.push(root);
	const personal = join(root, "personal");
	const workspaces = join(root, "workspaces.json");
	const googleAccounts = join(root, "google-accounts.json");
	const memory = join(root, "personal-memory.md");
	const sport = join(root, "sport.json");
	const sportInbox = join(root, "sport-inbox");
	const placeFlags: [string, string][] = [[PERSONAL_FLAGS.dir, personal], [PERSONAL_FLAGS.workspaces, workspaces], [PERSONAL_FLAGS.googleAccounts, googleAccounts]];
	const memoryFlags: [string, string][] = [...placeFlags, [PERSONAL_FLAGS.memory, memory]];
	const sportFlags: [string, string][] = [[PERSONAL_FLAGS.sport, sport], [PERSONAL_FLAGS.sportInbox, sportInbox]];
	const named = new Map<string, string>({ all: [...memoryFlags, ...sportFlags], memory: memoryFlags, bot: placeFlags, none: [] }[flags]);
	/** Saves `workspaces.json` as Settings › Workspaces would, with `personal` placed in the Personal space. */
	const place = (personal: string[]) => writeFileSync(workspaces, JSON.stringify({ added: [], hidden: [], personal }));
	/** Saves `google-accounts.json` as Settings › Integrations would: each account's address by server, and the addresses placed in the Personal space. */
	const placeAccounts = (addresses: Record<string, string>, personal: string[]) => writeFileSync(googleAccounts, JSON.stringify({ addresses, personal, signedOut: {} }));
	return { root, personal, workspaces, memory, sport, place, placeAccounts, ...loadExtension(personalExtension, named, "/work/app") };
}

const told = (space: string, address: string): string =>
	`This session is in the user's ${space} space, and the user placed ${address} in it: use that account for this session's mail and calendar unless the user names another account.`;

test("a Bot's conversation and its subagents hear which Google account the user placed in their space, with no memory, and nothing when every account is in one space", async () => {
	const session = loadedPersonal("bot");
	session.placeAccounts({ gmail: "ana@example.com", "gmail-2": "ana@work.example", "google-calendar": "ana@example.com" }, ["ana@example.com"]);
	await session.start(session.personal);
	expect(session.tools()).toEqual([]);
	expect(await session.prompt("main", session.personal)).toEqual(["base", told("Personal", "ana@example.com")]);
	expect(await session.prompt("sub", "/work/app")).toEqual(["base", told("Work", "ana@work.example")]);
	session.placeAccounts({ gmail: "ana@example.com", "gmail-2": "ana@work.example", "gmail-3": "bo@example.com" }, ["ana@example.com"]);
	expect(await session.prompt("main", "/work/app")).toEqual([
		"base",
		"This session is in the user's Work space, and the user placed ana@work.example, bo@example.com in it: use those accounts for this session's mail and calendar unless the user names another account.",
	]);
	session.placeAccounts({ gmail: "ana@example.com", "gmail-2": "ana@work.example" }, []);
	expect(await session.prompt("main", "/work/app")).toEqual(undefined);
});

test("a personal session's prompt carries the memory, then the Google account its space uses", async () => {
	const session = loadedPersonal("memory");
	session.placeAccounts({ gmail: "ana@example.com", "gmail-2": "ana@work.example" }, ["ana@example.com"]);
	const [, personal, accounts] = (await session.prompt("main", session.personal)) ?? [];
	expect(personal).toStartWith("You are the user's personal assistant");
	expect(accounts).toBe(told("Personal", "ana@example.com"));
});

/** A repository at `<parent>/home` on `main`, with `wip` checked out in the linked worktree `home-wip`. */
async function repoWithWorktree(parent: string): Promise<{ main: string; worktree: string }> {
	const main = join(parent, "home");
	const worktree = join(parent, "home-wip");
	mkdirSync(main);
	await git(main, "init", "-q", "-b", "main");
	await git(main, "commit", "-q", "--allow-empty", "-m", "one");
	await git(main, "worktree", "add", "-q", "-b", "wip", worktree);
	return { main, worktree };
}

test("a session in the personal directory remembers a fact as a dated line, and its next turn's prompt carries it", async () => {
	const session = loadedPersonal();
	await session.start(session.personal);
	expect(session.tools()).toEqual(["remember", "sport"]);
	setSystemTime(new Date("2026-11-03T10:00:00.000Z"));
	await session.call("remember", { fact: "  Allergic to\npeanuts. " }, session.personal);
	await session.call("remember", { fact: "Cooks for four." }, session.personal);
	expect(readFileSync(session.memory, "utf8")).toBe("- 2026-11-03 Allergic to peanuts.\n- 2026-11-03 Cooks for four.\n");
	const [base, personal] = (await session.prompt("main", session.personal)) ?? [];
	expect(base).toBe("base");
	expect(personal).toStartWith("You are the user's personal assistant");
	expect(personal).toEndWith("\n- 2026-11-03 Allergic to peanuts.\n- 2026-11-03 Cooks for four.");
});

test("a session elsewhere gets neither the tool nor the memory, and a subagent in the personal directory gets no memory", async () => {
	const session = loadedPersonal();
	writeFileSync(session.memory, "- 2026-11-03 Allergic to peanuts.\n");
	await session.start("/work/app");
	expect(session.tools()).toEqual([]);
	expect(await session.prompt("main", "/work/app")).toEqual(undefined);
	expect(await session.prompt("main", join(session.personal, "recipes"))).toEqual(undefined);
	expect(await session.prompt("sub", session.personal)).toEqual(undefined);
	expect((await session.prompt("main", session.personal))?.[1]).toEndWith("\n- 2026-11-03 Allergic to peanuts.");
});

test("without the dashboard's flags the extension stays inert in any directory", async () => {
	const session = loadedPersonal("none");
	await session.start(session.personal);
	expect(session.tools()).toEqual([]);
	expect(await session.prompt("main", session.personal)).toEqual(undefined);
});

test("a session that moves into the personal directory gains remember on its next turn, and one that moves out can no longer write the memory", async () => {
	const session = loadedPersonal();
	await session.start("/work/app");
	expect(session.tools()).toEqual([]);
	expect(await session.prompt("main", session.personal)).toHaveLength(2);
	expect(session.tools()).toEqual(["remember", "sport"]);
	await expect(session.call("remember", { fact: "Cooks for four." }, "/work/app")).rejects.toThrow("not in the Personal space");
	expect(() => readFileSync(session.memory, "utf8")).toThrow("ENOENT");
});

test("a session in a repository placed in the Personal space gets remember, sport, and the memory as a project of the user's own life, and one placed back in Work loses them on its next turn", async () => {
	const session = loadedPersonal();
	const repo = join(session.root, "garden");
	mkdirSync(repo);
	writeFileSync(session.memory, "- 2026-11-03 Grows tomatoes.\n");
	session.place([repo]);
	await session.start(repo);
	expect(session.tools()).toEqual(["remember", "sport"]);
	const personal = (await session.prompt("main", repo))?.[1];
	expect(personal).toStartWith("This project is in the user's Personal space");
	expect(personal).not.toContain("personal assistant");
	expect(personal).toEndWith("\n- 2026-11-03 Grows tomatoes.");
	await session.call("remember", { fact: "Waters on Sundays." }, repo);
	expect(readFileSync(session.memory, "utf8")).toEndWith(" Waters on Sundays.\n");
	session.place([]);
	expect(await session.prompt("main", repo)).toEqual(undefined);
	await expect(session.call("remember", { fact: "Cooks for four." }, repo)).rejects.toThrow("not in the Personal space");
});

test("a linked worktree of a Personal repository is personal too, and its main checkout's subdirectory and other repositories are not", async () => {
	const session = loadedPersonal();
	const { main, worktree } = await repoWithWorktree(session.root);
	const other = join(session.root, "app");
	mkdirSync(other);
	session.place([main]);
	expect(await session.prompt("main", worktree)).toHaveLength(2);
	expect(await session.prompt("main", other)).toEqual(undefined);
	mkdirSync(join(main, "notes"));
	expect(await session.prompt("main", join(main, "notes"))).toEqual(undefined);
});

test("a workspaces file an older version wrote, without personal, places every repository in Work", async () => {
	const session = loadedPersonal();
	const repo = join(session.root, "garden");
	mkdirSync(repo);
	writeFileSync(session.workspaces, JSON.stringify({ added: [repo], hidden: [] }));
	await session.start(repo);
	expect(session.tools()).toEqual([]);
	expect(await session.prompt("main", repo)).toEqual(undefined);
	expect(await session.prompt("main", session.personal)).toHaveLength(2);
});

test("a memory past 16 KiB reaches the prompt as its newest facts only", async () => {
	const session = loadedPersonal();
	const lines = Array.from({ length: 1000 }, (_, index) => `- 2026-11-03 Fact number ${index}.`);
	writeFileSync(session.memory, `${lines.join("\n")}\n`);
	const prompt = (await session.prompt("main", session.personal))?.[1] ?? "";
	expect(prompt).toEndWith("\n- 2026-11-03 Fact number 999.");
	expect(prompt).not.toContain("Fact number 0.");
	const kept = prompt.split("\n").filter(line => line.startsWith("- 2026-11-03 Fact number "));
	expect(kept.join("\n").length).toBeLessThanOrEqual(16 * 1024);
	expect(kept.join("\n").length).toBeGreaterThan(15 * 1024);
});

test("without the sport flags a personal session keeps remember alone and its prompt names no training", async () => {
	const session = loadedPersonal("memory");
	writeFileSync(session.sport, JSON.stringify(STATE));
	await session.start(session.personal);
	expect(session.tools()).toEqual(["remember"]);
	expect((await session.prompt("main", session.personal))?.[1]).not.toContain("sport:");
});

test("a personal turn's prompt ends with today's phase, workouts, and pain flags once there is a plan, and names nothing before", async () => {
	const session = loadedPersonal();
	setSystemTime(new Date("2026-11-17T12:00:00"));
	expect((await session.prompt("main", session.personal))?.[1]).toEndWith("Nothing yet.");
	writeFileSync(session.sport, JSON.stringify({ ...STATE, plan: null }));
	expect((await session.prompt("main", session.personal))?.[1]).toEndWith("Nothing yet.");
	writeFileSync(session.sport, JSON.stringify({ ...STATE, log: [log("l1", "2026-11-14", { pain: { level: 4, where: "fingers" } })] }));
	expect((await session.prompt("main", session.personal))?.[1]).toEndWith("\nToday 2026-11-17, sport: phase transition; Semi-arquée et bloc max; pain flags: fingers 4/10 until 2026-11-21.");
});
