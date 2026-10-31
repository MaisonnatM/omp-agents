import { execFileSync } from "node:child_process";
import { positionals, within } from "../shell/commands";
import { CONFIG_FILE, type LandConfig, readConfig } from "./lander";

function gitOut(dir: string, args: string[]): string | null {
	try {
		return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}

/** The land config of the repository `dir` is in, `null` when it has none or cannot be read. */
function configAt(dir: string): LandConfig | null {
	const top = gitOut(dir, ["rev-parse", "--show-toplevel"]);
	if (top === null) return null;
	try {
		return readConfig(top);
	} catch {
		// A broken config refuses in `land` itself, with the reason; the gate leaves commands alone until it parses.
		return null;
	}
}

/** The branch a refspec's destination names, past a leading `+` and `refs/heads/`. */
function destination(refspec: string): string {
	const spec = refspec.replace(/^\+/, "");
	const dst = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
	return dst.replace(/^refs\/heads\//, "");
}

const BLOCKED = (what: string, config: LandConfig) =>
	`Blocked: this repository lands on ${config.remote}/${config.target} only through the \`land\` tool (${CONFIG_FILE}), which merges into a fresh copy of ${config.remote}/${config.target}, runs its checks on the merged result, and pushes. ${what} would skip that. Commit on your branch and call \`land\` with a divergence note instead.`;

/** Why the git or gh command `words`, run in `dir`, may not run, or `undefined` when it does not reach the target branch. */
export function bypass(words: string[], dir: string | null): string | undefined {
	const [tool, ...rest] = words;
	if (tool !== "git" && tool !== "gh") return undefined;
	let at = dir;
	let i = 0;
	for (; tool === "git" && i < rest.length && rest[i].startsWith("-"); i++) {
		if (rest[i] === "-C") at = within(at, rest[++i]);
		else if (rest[i] === "-c") i++;
	}
	const sub = rest[i];
	const args = rest.slice(i + 1);
	const pushes = tool === "git" && sub === "push";
	const merges = tool === "git" && sub === "merge";
	const prMerge = tool === "gh" && sub === "pr" && args[0] === "merge";
	if (!pushes && !merges && !prMerge) return undefined;
	if (at === null) {
		return pushes || prMerge
			? `Blocked: \`${words.join(" ")}\` runs in a directory this gate cannot locate, because a variable, a command substitution, or \`cd -\` names it, so it cannot tell whether the repository lands through \`land\`. Write the directory out, then retry.`
			: undefined;
	}
	const config = configAt(at);
	if (!config) return undefined;
	if (prMerge) return BLOCKED("Merging the pull request on GitHub", config);
	const current = gitOut(at, ["symbolic-ref", "--short", "-q", "HEAD"]);
	if (merges) {
		if (current !== config.target || args.some(a => a === "--abort" || a === "--quit" || a === "--continue")) return undefined;
		if (args.includes("--ff-only") && positionals(args).every(p => p === `${config.remote}/${config.target}`)) return undefined;
		return BLOCKED(`Merging into ${config.target}`, config);
	}
	if (args.some(a => a === "--all" || a === "--mirror" || a === "--branches")) return BLOCKED("Pushing every branch", config);
	const [remote, ...refspecs] = positionals(args);
	if (remote !== undefined && remote !== config.remote) return undefined;
	const reaches = refspecs.length === 0 ? current === config.target : refspecs.some(r => destination(r) === config.target || (r === "HEAD" && current === config.target));
	return reaches ? BLOCKED(`Pushing to ${config.target}`, config) : undefined;
}
