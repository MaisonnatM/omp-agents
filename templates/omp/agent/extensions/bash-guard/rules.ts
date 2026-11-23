// The rules `bash-guard.ts` applies before a bash or read call runs, each naming what the agent should do instead.
// A push to the target of a repository that lands through `land` is `land/gate.ts`'s; these fill the gaps around it.
import { execFileSync } from "node:child_process";
import { configAt } from "../land/gate";
import { located, positionals, program, split, within } from "../shell/commands";

/** Why a call may not run; `ask` holds the question when the user may still allow it. */
export interface Verdict {
	reason: string;
	ask?: string;
}

function output(command: string, args: string[]): string {
	try {
		return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

/** The verdict on a bash line run from `cwd`, or `undefined` when it may run. */
export function checkBash(line: string, cwd: string | null): Verdict | undefined {
	return secretRead(line) ?? skippedHooks(line, cwd) ?? defaultPort(line) ?? dashboardKill(line) ?? forcePushMain(line, cwd);
}

/** The verdict on a `read` tool call of `path`, or `undefined` when it may run. */
export function checkRead(path: string): Verdict | undefined {
	if (path.includes("://")) return undefined;
	const reason = secretFile(path.replace(/:[^/]*$/, ""));
	return reason ? { reason: reason(`This read of ${path}`) } : undefined;
}

// --- Secret files -------------------------------------------------------------------------------------------------

/** Commands that print a file's content. */
const READERS: Record<string, true> = { cat: true, tac: true, bat: true, head: true, tail: true, less: true, more: true, nl: true, strings: true, xxd: true, od: true, hexdump: true };
/** `.env` variants that hold placeholders, not values. */
const TEMPLATE = /\.(?:example|sample|template|tpl|dist|defaults|schema)$/i;

/** The reason a read of `path` exposes a secret, given how the call reads it, or `undefined` for any other file. */
function secretFile(path: string): ((what: string) => string) | undefined {
	const name = path.replace(/\/+$/, "");
	const base = name.slice(name.lastIndexOf("/") + 1);
	if (/(?:^|\/)omp-agents\/token$/.test(name)) {
		return what =>
			`${what} would print the omp-agents dashboard's access token into this session. Use it only inside the request's header, as AGENTS.md shows: \`curl -sS -H "Authorization: Bearer $(cat "\${XDG_CONFIG_HOME:-$HOME/.config}/omp-agents/token")" http://127.0.0.1:4317/api/...\`.`;
	}
	if (/^\.env(?:\..+|\*)?$/.test(base) && !TEMPLATE.test(base)) {
		return what =>
			`${what} would print the secrets in ${path} into this session. To see which variables it sets, run \`cut -d= -f1 ${path}\`; to use them, load the file in the command that needs them, as in \`set -a; . ${path}; set +a; <command>\`. Ask the user when you need a value itself.`;
	}
	return undefined;
}

/**
 * Reads that keep the secret out of the output: the dashboard token inside a curl `Authorization` header, as AGENTS.md
 * documents, and a `.env` loaded with `export $(...)` or `env $(...)`.
 */
const HIDDEN_READS = [/Authorization:\s*Bearer\s+\$\(cat\s+("[^"]*"|'[^']*'|[^\s)]+)\)/g, /\b(?:export|env)\s+\$\([^)]*\)/g];

function secretRead(line: string): Verdict | undefined {
	let shown = line;
	if (split(line).some(words => program(words).words[0] === "curl")) shown = shown.replace(HIDDEN_READS[0]!, "Authorization: Bearer TOKEN");
	shown = shown.replace(HIDDEN_READS[1]!, "export");
	for (const { words } of located(shown, null)) {
		const [tool, ...args] = words;
		if (tool === undefined || !Object.hasOwn(READERS, tool)) continue;
		for (const arg of positionals(args)) {
			const reason = secretFile(arg);
			if (reason) return { reason: reason(`\`${words.join(" ")}\``) };
		}
	}
	return undefined;
}

// --- git ----------------------------------------------------------------------------------------------------------

interface GitCommand {
	sub: string | undefined;
	args: string[];
	/** The directory it runs in, after `-C`; `null` when a variable names it. */
	at: string | null;
	/** `-c core.hooksPath=...` points the hooks elsewhere. */
	hooksMoved: boolean;
}

function gitCommand(words: string[], dir: string | null): GitCommand | null {
	if (words[0] !== "git") return null;
	let at = dir;
	let hooksMoved = false;
	let i = 1;
	for (; i < words.length && words[i]!.startsWith("-"); i++) {
		const flag = words[i]!;
		if (flag === "-C") at = within(at, words[++i]);
		else if (flag === "-c") hooksMoved ||= /^core\.hookspath=/i.test(words[++i] ?? "");
		else if (flag === "--git-dir" || flag === "--work-tree" || flag === "--namespace") i++;
	}
	return { sub: words[i], args: words.slice(i + 1), at, hooksMoved };
}

/** `git commit` options that take the next word as their value. */
const COMMIT_VALUE = /^--(?:message|file|author|date|template|reuse-message|reedit-message|fixup|squash|trailer|cleanup|pathspec-from-file)$/;

/** Whether `git <sub> <args>` skips the repository's hooks: `--no-verify`, or `-n` in a commit's short options. */
function skipsHooks(sub: string, args: string[]): boolean {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--") return false;
		if (arg === "--no-verify") return true;
		if (sub !== "commit") continue;
		if (COMMIT_VALUE.test(arg)) {
			i++;
			continue;
		}
		const cluster = arg.match(/^-([A-Za-z]+)$/)?.[1];
		if (!cluster) continue;
		for (let k = 0; k < cluster.length; k++) {
			const c = cluster[k]!;
			if (c === "n") return true;
			// The rest of the word, or the next word, is this option's value; `-S` and `-u` take only an attached one.
			if ("mFCctSu".includes(c)) {
				if (k === cluster.length - 1 && "mFCct".includes(c)) i++;
				break;
			}
		}
	}
	return false;
}

function skippedHooks(line: string, cwd: string | null): Verdict | undefined {
	for (const { words, dir } of located(line, cwd)) {
		const git = gitCommand(words, dir);
		if (!git || (git.sub !== "commit" && git.sub !== "push")) continue;
		if (!git.hooksMoved && !skipsHooks(git.sub, git.args)) continue;
		return {
			reason: `\`${words.join(" ")}\` skips the repository's hooks, which run its checks. Run it without \`--no-verify\`, \`-n\`, or \`-c core.hooksPath\`, and fix what the hook reports; when the hook itself is broken, tell the user rather than skip it.`,
		};
	}
	return undefined;
}

/** `git push` options that take the next word as their value. */
const PUSH_VALUE: Record<string, true> = { "-o": true, "--push-option": true, "--repo": true, "--receive-pack": true, "--exec": true };
const MAIN_BRANCHES = ["main", "master"];

function forcePushMain(line: string, cwd: string | null): Verdict | undefined {
	for (const { words, dir } of located(line, cwd)) {
		const git = gitCommand(words, dir);
		if (!git || git.sub !== "push" || git.at === null) continue;
		const args = git.args.filter((arg, i) => !Object.hasOwn(PUSH_VALUE, arg) && !Object.hasOwn(PUSH_VALUE, git.args[i - 1] ?? ""));
		const [, ...refspecs] = positionals(args);
		const rewrites =
			args.some(a => a === "--force" || a === "--delete" || a.startsWith("--force-with-lease") || /^-[a-z]*[fd][a-z]*$/.test(a)) ||
			refspecs.some(r => r.startsWith("+") || r.startsWith(":"));
		if (!rewrites) continue;
		const everything = args.some(a => a === "--all" || a === "--mirror" || a === "--branches");
		const current = () => output("git", ["-C", git.at!, "symbolic-ref", "--short", "-q", "HEAD"]);
		const reaches =
			everything ||
			(refspecs.length === 0
				? MAIN_BRANCHES.includes(current())
				: refspecs.some(r => {
						const spec = r.replace(/^\+/, "");
						const dst = (spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec).replace(/^refs\/heads\//, "");
						return MAIN_BRANCHES.includes(dst) || (dst === "HEAD" && MAIN_BRANCHES.includes(current()));
					}));
		// A repository that lands through `land` refuses every push to its target in `land/gate.ts`.
		if (!reaches || configAt(git.at)) continue;
		return {
			reason: `\`${words.join(" ")}\` force-pushes to or deletes main or master, which rewrites the history every other clone builds on; AGENTS.md allows that only with the user's explicit approval.`,
			ask: `Allow \`${words.join(" ")}\`? It rewrites or deletes main or master on the remote.`,
		};
	}
	return undefined;
}

// --- The omp-agents dashboard -------------------------------------------------------------------------------------

/** Command lines and names of the dashboard's processes: its server, the keepers that hold its sessions, and the desktop app. */
const DASHBOARD_LINES = [
	"/Users/u/code/omp-agents/node_modules/bun/bin/bun.exe /Users/u/code/omp-agents/src/server.ts",
	"/Users/u/code/omp-agents/node_modules/bun/bin/bun.exe /Users/u/code/omp-agents/src/keeper.ts /Users/u/.config/omp-agents/sessions/4317/abc",
	"/Users/u/code/omp-agents/desktop/dist/omp agents.app/Contents/MacOS/Electron /Users/u/code/omp-agents/desktop",
];
const DASHBOARD_NAMES = ["bun", "bun.exe", "Electron", "Electron Helper", "omp agents"];
/** A running process's command line that is the dashboard's. */
const DASHBOARD_PROCESS = /omp-agents\/(?:src\/(?:server|keeper)\.ts|desktop)|omp agents\.app/;
/** Text in a kill command that aims at the dashboard: its port, or its name outside a worktree path. */
const DASHBOARD_MENTION = /(?<!\d)4317(?!\d)|omp[- ]agents(?!-wt)/i;

/** `pkill` and `pgrep` options, and `killall` ones, that take the next word as their value. */
const PGREP_VALUE: Record<string, true> = { "-F": true, "-G": true, "-g": true, "-P": true, "-t": true, "-U": true, "-u": true, "-s": true };
const KILLALL_VALUE: Record<string, true> = { "-u": true, "-t": true, "-c": true };

/** Whether `pkill`/`pgrep` arguments select a dashboard process. */
function pgrepHits(args: string[]): boolean {
	const flags = args.filter(a => a.startsWith("-")).join("");
	const patterns = positionals(args.filter((a, i) => !Object.hasOwn(PGREP_VALUE, args[i - 1] ?? "")));
	const targets = flags.includes("f") ? DASHBOARD_LINES : DASHBOARD_NAMES;
	return patterns.some(pattern => {
		let re: RegExp;
		try {
			re = new RegExp(flags.includes("x") ? `^(?:${pattern})$` : pattern, flags.includes("i") ? "i" : "");
		} catch {
			return false;
		}
		return targets.some(t => re.test(t));
	});
}

function killallHits(args: string[]): boolean {
	const regex = args.includes("-m");
	const names = positionals(args.filter((a, i) => !Object.hasOwn(KILLALL_VALUE, args[i - 1] ?? "")));
	return names.some(name => {
		if (!regex) return DASHBOARD_NAMES.includes(name);
		try {
			return DASHBOARD_NAMES.some(n => new RegExp(name).test(n));
		} catch {
			return false;
		}
	});
}

/** Whether any of `pids` is a dashboard process, by its command line or by listening on 4317. */
function dashboardPid(pids: string[]): boolean {
	if (pids.length === 0) return false;
	if (DASHBOARD_PROCESS.test(output("ps", ["-o", "command=", "-p", pids.join(",")]))) return true;
	const listener = output("lsof", ["-nP", "-iTCP:4317", "-sTCP:LISTEN", "-t"]).split("\n");
	return pids.some(pid => listener.includes(pid));
}

/** A command's words past `sudo`, `xargs`, `command`, and `exec`, with their flags. */
function unwrap(words: string[]): string[] {
	let w = program(words).words;
	while (["sudo", "xargs", "command", "exec", "nohup"].includes(w[0] ?? "")) {
		let k = 1;
		while (k < w.length && w[k]!.startsWith("-")) k++;
		w = w.slice(k);
	}
	return w;
}

function dashboardKill(line: string): Verdict | undefined {
	// One `&&`, `||`, `;`, or newline-separated part at a time, so a pipe or `$(...)` that finds the pid counts with its kill.
	for (const part of line.split(/&&|\|\||;|\n/)) {
		const commands = split(part).map(unwrap);
		const killer = commands.find(w => ["kill", "pkill", "killall", "osascript"].includes(w[0] ?? ""));
		if (!killer) continue;
		let hits = false;
		if (killer[0] === "osascript") hits = /\b(?:quit|kill)\b/i.test(part) && /omp[- ]agents|Electron/i.test(part);
		else if (killer[0] === "kill" && killer.slice(1).some(a => a === "-0" || a === "-l")) hits = false;
		else
			hits =
				DASHBOARD_MENTION.test(part) ||
				commands.some(([tool, ...args]) => ((tool === "pkill" || tool === "pgrep") && pgrepHits(args)) || (tool === "killall" && killallHits(args))) ||
				(killer[0] === "kill" && dashboardPid(positionals(killer.slice(1)).filter(a => /^\d+$/.test(a))));
		if (!hits) continue;
		return {
			reason: `\`${part.trim()}\` would stop the omp-agents dashboard, and its window and the sessions it shows go down with it. To load new commits, ask the dashboard to update itself as AGENTS.md's "omp-agents dashboard" section shows; when it needs a restart, ask the user. To stop a server you started, kill it by the pid you started, not by name or port.`,
		};
	}
	return undefined;
}

// --- Default ports ------------------------------------------------------------------------------------------------

const DEFAULT_PORTS: Record<string, true> = { "3000": true, "3001": true, "4200": true, "4317": true, "5000": true, "5173": true, "8000": true, "8080": true };
/** Dev servers, where `-p` names the port rather than, as for `ssh` or `docker`, something else. */
const DEV_SERVERS: Record<string, true> = {
	vite: true, next: true, nuxt: true, nuxi: true, astro: true, remix: true, serve: true, "http-server": true, "live-server": true, webpack: true,
	"webpack-dev-server": true, ng: true, rails: true, flask: true, uvicorn: true, hugo: true, jekyll: true, storybook: true, wrangler: true, expo: true, parcel: true,
};
const RUNNERS: Record<string, true> = { bun: true, bunx: true, npm: true, npx: true, pnpm: true, yarn: true };
const SCRIPTS: Record<string, true> = { dev: true, start: true, serve: true, preview: true };
/** Clients whose `--port` names the server they connect to. */
const CLIENTS: Record<string, true> = { curl: true, wget: true, ssh: true, scp: true, sftp: true, nc: true, telnet: true, lsof: true, psql: true, mysql: true, "redis-cli": true, mongosh: true };

function defaultPort(line: string): Verdict | undefined {
	for (const raw of split(line)) {
		const words = unwrap(raw);
		const [tool] = words;
		let port: string | undefined;
		// `PORT=N cmd`, `env PORT=N cmd`, and `export PORT=N`.
		for (const word of raw) {
			const set = word.match(/^PORT=(\d+)$/)?.[1];
			if (set) port = set;
			else if (word !== "env" && word !== "export" && !/^[A-Za-z_]\w*=/.test(word)) break;
		}
		const dev = words.some(w => Object.hasOwn(DEV_SERVERS, w)) || (Object.hasOwn(RUNNERS, tool ?? "") && words.some(w => Object.hasOwn(SCRIPTS, w)));
		for (let i = 1; i < words.length && port === undefined && !Object.hasOwn(CLIENTS, tool ?? ""); i++) {
			const word = words[i]!;
			port = word.match(/^--port=(\d+)$/)?.[1] ?? (word === "--port" ? words[i + 1] : undefined);
			if (dev) port ??= word.match(/^-p(\d+)$/)?.[1] ?? (word === "-p" ? words[i + 1] : undefined);
			// `python -m http.server` listens on 8000 unless a port follows.
			if (word === "http.server") port ??= positionals(words.slice(i + 1)).find(w => /^\d+$/.test(w)) ?? "8000";
		}
		if (port === undefined || !Object.hasOwn(DEFAULT_PORTS, port)) continue;
		return {
			reason: `\`${raw.join(" ")}\` starts a listener on port ${port}, a default port (${Object.keys(DEFAULT_PORTS).join(", ")}) where the user's own servers, the dashboard, and other sessions run. Pick a free port instead, such as a random one between 20000 and 60000, and pass it the same way.`,
		};
	}
	return undefined;
}
