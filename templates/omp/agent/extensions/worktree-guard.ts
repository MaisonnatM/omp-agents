// Guards the checkouts agents change in place.
// - The main checkout on its default branch takes no `edit` or `write`: the agent works in a linked worktree, as AGENTS.md asks.
// - A checkout belongs to the omp process that last changed it, a session and its in-process subagents. While that process
//   lives and the checkout holds uncommitted changes to tracked files, another process's edits, writes, and git, gt, or
//   `gh pr checkout` commands that change the checkout are blocked, and that process works in a worktree of its own.
// - Once HEAD is no longer where the owner left it, the owner's changes are blocked until a switch of its own succeeds.
// Reads, files outside git, internal URLs such as `local://`, and the clones omp makes for isolated subagents pass.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { commands } from "./shell/commands";

/** What a command does to the checkout it runs in: `switch` moves HEAD to a named branch or commit. */
type Effect = "read" | "switch" | "write";
/** How a call changes a checkout: by a command's effect, or `edit` for the edit and write tools. */
type Kind = Exclude<Effect, "read"> | "edit";

/** git, gt, and gh subcommands that change the checkout they run in, each with its effect or a rule over its arguments; any other subcommand reads. */
const CHANGES: Record<"git" | "gt" | "gh", Record<string, Effect | ((args: string[]) => Effect)>> = {
	git: {
		add: "write", am: "write", apply: "write", bisect: "write", "cherry-pick": "write", clean: "write", commit: "write", merge: "write",
		mv: "write", pull: "write", rebase: "write", reset: "write", restore: "write", revert: "write", rm: "write",
		branch: args => (args.some(a => ["-m", "-M", "--move"].includes(a)) ? "write" : "read"),
		stash: args => (args[0] === "list" || args[0] === "show" ? "read" : "write"),
		// Creating a branch carries the tree's state onto it, and restoring paths discards changes: both write rather than switch.
		switch: args => (args.some(a => ["-c", "-C", "--create", "--force-create", "--orphan"].includes(a)) ? "write" : "switch"),
		checkout: args => (args.some(a => ["-b", "-B", "--orphan", "--", "."].includes(a)) || positionals(args).length !== 1 ? "write" : "switch"),
		// Changes the worktree it names, which `changes` resolves; `--force` removes one with uncommitted changes.
		worktree: args => (args[0] === "remove" || args[0] === "move" ? "write" : "read"),
	},
	// Names and aliases from `gt --help --all`.
	gt: {
		checkout: "switch", co: "switch",
		absorb: "write", ab: "write", abort: "write", bottom: "write", b: "write", continue: "write", cont: "write", create: "write", c: "write",
		delete: "write", dl: "write", down: "write", d: "write", fold: "write", get: "write", modify: "write", m: "write", move: "write",
		pop: "write", rename: "write", rn: "write", reorder: "write", restack: "write", r: "write", revert: "write", split: "write", sp: "write",
		squash: "write", sq: "write", sync: "write", top: "write", t: "write", undo: "write", up: "write", u: "write",
	},
	gh: {
		pr: args => (args[0] === "checkout" ? "switch" : "read"),
	},
};
/** Commands that run the command after their own flags and `NAME=value` settings. */
const WRAPPERS: Record<string, true> = { builtin: true, command: true, env: true, exec: true, nice: true, nohup: true, sudo: true, time: true };
const SHELLS: Record<string, true> = { bash: true, sh: true, zsh: true };

/** The claim lives in a checkout's own git dir: `.git/` for a main checkout, `.git/worktrees/<name>/` for a linked one. */
const CLAIM = "omp-checkout-owner.json";
/** Present in a git dir while a merge, cherry-pick, revert, or rebase waits to be finished. */
const UNFINISHED = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"];

interface Claim {
	pid: number;
	/** `ps -o lstart=` of the pid, so a reused pid reads as another process. */
	started: string;
	/** The session that took the claim, named in block reasons. */
	session: string;
	at: string;
}

/** This process: a session and its in-process subagents. omp loads the extension afresh for each session, so the state lives on `globalThis`. */
interface Family {
	pid: number;
	started: string;
	/** Where this process last left HEAD in each checkout it changed, by git dir: `refs/heads/<branch>`, or a commit when detached. */
	expected: Map<string, string>;
	/** The checkouts each running bash call changes, as they were before it ran, by tool call id: a switch git refused leaves HEAD as it was. */
	before: Map<string, Checkout[]>;
}

function family(): Family {
	const store = globalThis as Record<symbol, Family | undefined>;
	return (store[Symbol.for("omp-agents.worktree-guard")] ??= { pid: process.pid, started: startOf(process.pid), expected: new Map(), before: new Map() });
}

function startOf(pid: number): string {
	try {
		return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

/** Whether the claim's process still runs; a process this one cannot inspect counts as running. */
function alive(claim: Claim): boolean {
	try {
		process.kill(claim.pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
	}
	const started = startOf(claim.pid);
	return started === "" || started === claim.started;
}

const mine = (claim: Claim | null, me: Family) => claim?.pid === me.pid && claim.started === me.started;

/** git's answer in `dir`, or `""` when it fails. */
function git(dir: string, args: string[]): string {
	try {
		return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

interface Checkout {
	top: string;
	gitDir: string;
	/** The repository's main checkout, not a linked worktree. */
	main: boolean;
	graphite: boolean;
	/** `refs/heads/<branch>`, or the commit a detached HEAD points at. */
	head: string;
}

/** The checkout `path` is in, or `null` for a path outside git or in an isolated subagent's clone. */
function checkoutAt(path: string): Checkout | null {
	let dir = path;
	while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
	if (!statSync(dir).isDirectory()) dir = dirname(dir);
	const [gitDir, commonDir, top] = git(dir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"]).split("\n");
	if (!gitDir || !commonDir || !top) return null;
	// omp clones the repository to `<base>/m` for an isolated subagent and marks `<base>` with its owner.
	if (existsSync(join(dirname(top), ".omp-isolation-owner.json"))) return null;
	return {
		top,
		gitDir,
		main: gitDir === commonDir,
		graphite: existsSync(join(commonDir, ".graphite_repo_config")),
		head: headOf(top),
	};
}

/** `refs/heads/<branch>`, the commit a detached HEAD points at, or `""` when `top` is no longer a checkout. */
const headOf = (top: string) => git(top, ["symbolic-ref", "--quiet", "HEAD"]) || git(top, ["rev-parse", "HEAD"]);

/** The default branch a main checkout has checked out, from `origin/HEAD`, else `main` or `master`, or `null` for any other checkout or branch. */
function defaultBranch(c: Checkout): string | null {
	if (!c.main) return null;
	const branch = c.head.replace(/^refs\/heads\//, "");
	const originHead = git(c.top, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, "");
	return (originHead ? [originHead] : ["main", "master"]).includes(branch) ? branch : null;
}

/** Work a branch switch would carry off or break: uncommitted changes to tracked files, or an unfinished merge, cherry-pick, revert, or rebase. */
function working(c: Checkout): boolean {
	return UNFINISHED.some(name => existsSync(join(c.gitDir, name))) || git(c.top, ["status", "--porcelain", "--untracked-files=no"]) !== "";
}

const label = (head: string) => (head.startsWith("refs/heads/") ? `\`${head.slice(11)}\`` : `a detached HEAD at \`${head.slice(0, 12)}\``);
const switchTo = (top: string, head: string) => `git -C ${top} switch ${head.startsWith("refs/heads/") ? head.slice(11) : `--detach ${head}`}`;

function readClaim(gitDir: string): Claim | null {
	try {
		const claim = JSON.parse(readFileSync(join(gitDir, CLAIM), "utf8"));
		return typeof claim?.pid === "number" && typeof claim.started === "string" && typeof claim.session === "string" ? claim : null;
	} catch {
		return null;
	}
}

/**
 * The block reason for a change of `kind` to `c`, which `what` names, or `undefined` once this process owns `c` and the change may run.
 * Claims are written whole by rename, so a reader never sees half of one; two processes that take one checkout in the same instant can both pass.
 */
function guard(c: Checkout, kind: Kind, what: string, ctx: ExtensionContext): string | undefined {
	const me = family();
	const claim = readClaim(c.gitDir);
	if (claim && !mine(claim, me) && alive(claim) && working(c)) {
		return [
			`${c.top} belongs to another omp session (session ${claim.session}, pid ${claim.pid}), which has uncommitted changes or an unfinished merge or rebase on ${label(c.head)} there.`,
			`${what} would change that checkout under it.`,
			"Do your work in a worktree of your own: `git worktree add -b <branch> ~/code/<repo>-wt/<topic> <parent>`.",
			"This stays blocked while that session runs with changes there, however often you retry.",
			`Only if the user tells you that session is done, delete ${join(c.gitDir, CLAIM)}, then retry.`,
		].join(" ");
	}
	const expected = me.expected.get(c.gitDir);
	if (expected && expected !== c.head && kind !== "switch") {
		return [
			`${c.top} is on ${label(c.head)}, but this session left it on ${label(expected)}: another process switched it.`,
			"Your uncommitted changes may have moved with it or into a stash, and the changes in the tree now may not be yours.",
			`Check \`git -C ${c.top} status\`, \`git -C ${c.top} stash list\`, and \`git -C ${c.top} reflog -n 5\`.`,
			`Then run one switch as its own command: \`${switchTo(c.top, expected)}\` to go back, or \`${switchTo(c.top, c.head)}\` to stay there on purpose.`,
			"Changes to this checkout stay blocked until a switch succeeds, however often you retry.",
		].join(" ");
	}
	const branch = kind === "edit" ? defaultBranch(c) : null;
	if (branch) {
		return [
			`${c.top} is the repository's main checkout, on its default branch \`${branch}\`.`,
			"Create a worktree on a new branch (`git worktree add -b <branch> ~/code/<repo>-wt/<topic> <parent>`) and make the change there.",
			...(c.graphite ? ["This repository uses Graphite: run `gt track <branch> -p <parent>` in the new worktree before you commit."] : []),
			"Edits on the default branch stay blocked, however often you retry. When the user asked you to work in place, switch the main checkout to a branch (`git switch -c <branch>`), then retry the call.",
		].join(" ");
	}
	if (!mine(claim, me)) {
		const file = join(c.gitDir, CLAIM);
		const next: Claim = { pid: me.pid, started: me.started, session: ctx.sessionManager.getSessionId(), at: new Date().toISOString() };
		writeFileSync(`${file}.${me.pid}`, JSON.stringify(next));
		renameSync(`${file}.${me.pid}`, file);
	}
	if (!expected) me.expected.set(c.gitDir, c.head);
	return undefined;
}

/** A command's positional words: not flags, and not redirections such as `>/dev/null`, `2>&1`, or a bare `>` and its target. */
function positionals(args: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const redirect = args[i].match(/^(?:\d*|&)(?:>>|>&|<&|>|<)(.*)$/);
		if (redirect) {
			if (!redirect[1]) i++;
		} else if (args[i] === "-" || !args[i].startsWith("-")) {
			out.push(args[i]);
		}
	}
	return out;
}

/** `path`, which defaults to home, resolved from `dir` with `~` and `$HOME` expanded; `null` when another variable, a command substitution, or an unknown `dir` decides it. */
function within(dir: string | null, path: string | undefined): string | null {
	const home = process.env.HOME ?? "";
	const expanded = (path ?? home).replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
	if (/[$`]/.test(expanded)) return null;
	if (isAbsolute(expanded)) return expanded;
	return dir === null ? null : resolve(dir, expanded);
}

interface Change {
	effect: Exclude<Effect, "read">;
	/** The directory the command runs in, or `null` when the line names it through a variable. */
	dir: string | null;
	words: string[];
}

/** The commands of a bash line run from `cwd` that change a checkout, following `cd`, `pushd`, `git -C`, `gt --cwd`, wrappers such as `env`, and `bash -c` scripts. */
function changes(line: string, cwd: string | null): Change[] {
	const out: Change[] = [];
	let dir = cwd;
	for (let words of commands(line)) {
		while (words[0] !== undefined && Object.hasOwn(WRAPPERS, words[0])) {
			let k = 1;
			while (k < words.length && (words[k].startsWith("-") || /^[A-Za-z_]\w*=/.test(words[k]))) k++;
			words = words.slice(k);
		}
		const [tool = "", ...rest] = words;
		if (tool === "cd" || tool === "pushd") {
			const [to] = positionals(rest);
			dir = to === "-" || (tool === "pushd" && to === undefined) ? null : within(dir, to);
		} else if (tool === "popd") {
			dir = null;
		} else if (Object.hasOwn(SHELLS, tool)) {
			const flag = rest.findIndex(a => /^-\w*c\w*$/.test(a));
			if (flag !== -1 && rest[flag + 1] !== undefined) out.push(...changes(rest[flag + 1], dir));
		}
		if (tool !== "git" && tool !== "gt" && tool !== "gh") continue;
		let at = dir;
		let i = 0;
		for (; i < rest.length && rest[i].startsWith("-"); i++) {
			const flag = rest[i];
			if ((tool === "git" && flag === "-C") || (tool === "gt" && flag === "--cwd")) at = within(at, rest[++i]);
			else if (tool === "gt" && flag.startsWith("--cwd=")) at = within(at, flag.slice(6));
			else if (tool === "git" && flag === "-c") i++;
			else if (tool === "git" && /^--(?:git-dir|work-tree)(?:=|$)/.test(flag)) {
				at = null;
				if (!flag.includes("=")) i++;
			}
		}
		const sub = rest[i] ?? "";
		const rule = Object.hasOwn(CHANGES[tool], sub) ? CHANGES[tool][sub] : "read";
		const effect = typeof rule === "function" ? rule(rest.slice(i + 1)) : rule;
		if (effect === "read") continue;
		if (tool === "git" && sub === "worktree") {
			const [target] = positionals(rest.slice(i + 2));
			if (target !== undefined) at = within(at, target);
		}
		out.push({ effect, dir: at, words });
	}
	return out;
}

/** The files an `edit` or `write` call touches: its `path`, and each `[path#TAG]` header of a hashline edit. */
function targets(input: Record<string, unknown>): string[] {
	const paths = typeof input.path === "string" ? [input.path] : [];
	if (typeof input.input === "string") for (const match of input.input.matchAll(/^\[(.+)#[0-9A-Fa-f]{4}\]$/gm)) if (match[1]) paths.push(match[1]);
	return paths.filter(path => !path.includes("://"));
}

export default function worktreeGuard(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		// Each checkout the call changes, judged once by the strongest change the call makes there: a write over a switch.
		const touched = new Map<string, { c: Checkout; kind: Kind; what: string }>();
		const touch = (c: Checkout | null, kind: Kind, what: string) => {
			if (c && touched.get(c.gitDir)?.kind !== "write") touched.set(c.gitDir, { c, kind, what });
		};
		if (event.toolName === "edit" || event.toolName === "write") {
			for (const path of targets(input)) touch(checkoutAt(resolve(ctx.cwd, path.replace(/^~(?=\/)/, process.env.HOME ?? "~"))), "edit", `This ${event.toolName} of ${path}`);
		} else if (event.toolName === "bash" && typeof input.command === "string") {
			for (const change of changes(input.command, typeof input.cwd === "string" ? resolve(ctx.cwd, input.cwd) : ctx.cwd)) {
				const command = `\`${change.words.join(" ")}\``;
				if (change.dir === null) {
					return {
						block: true,
						reason: `${command} changes a checkout this guard cannot locate, because a variable, a command substitution, or \`cd -\` names its directory. Write the directory out, as in \`git -C /absolute/path ...\` or \`cd /absolute/path && ...\`, then retry.`,
					};
				}
				touch(checkoutAt(change.dir), change.effect, command);
			}
		}
		for (const { c, kind, what } of touched.values()) {
			const reason = guard(c, kind, what, ctx);
			if (reason) return { block: true, reason };
		}
		if (event.toolName === "bash" && touched.size > 0) family().before.set(event.toolCallId, [...touched.values()].map(({ c }) => c));
	});

	// Adopts the HEAD the owner's own command left once it succeeded or moved HEAD, as `git switch x && false` does; a switch git refused keeps the drift block.
	pi.on("tool_result", event => {
		const me = family();
		const before = me.before.get(event.toolCallId);
		me.before.delete(event.toolCallId);
		for (const c of before ?? []) {
			const head = headOf(c.top);
			// A process that took the checkout while the command ran owns what HEAD is now; this one's next change reports the switch.
			if (head && (!event.isError || head !== c.head) && mine(readClaim(c.gitDir), me)) me.expected.set(c.gitDir, head);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.agent.kind === "sub") return;
		const me = family();
		for (const gitDir of me.expected.keys()) if (mine(readClaim(gitDir), me)) rmSync(join(gitDir, CLAIM), { force: true });
		me.expected.clear();
		me.before.clear();
	});
}
