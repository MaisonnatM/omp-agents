// Blocks every `edit` or `write` to a file in a repository's main checkout while it is on its default branch, so the
// agent makes its changes in a linked worktree, as AGENTS.md asks. On any other branch the checkout is edited in place.
// A file git ignores, such as `.env`, is in no worktree, so its edit goes ahead in the main checkout once the user approves it.
// Files outside git, internal URLs such as `local://`, and the clones omp makes for isolated subagents pass.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** The files an `edit` or `write` call touches: its `path`, and each `[path#TAG]` header of a hashline edit. */
function targets(input: Record<string, unknown>): string[] {
	const paths = typeof input.path === "string" ? [input.path] : [];
	if (typeof input.input === "string") for (const match of input.input.matchAll(/^\[(.+)#[0-9A-Fa-f]{4}\]$/gm)) if (match[1]) paths.push(match[1]);
	return paths.filter(path => !path.includes("://"));
}

/** git's answer in `dir`, or `""` when it fails. */
function git(dir: string, args: string[]): string {
	try {
		return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

interface MainCheckout {
	top: string;
	graphite: boolean;
	/** The default branch it has checked out, from `origin/HEAD`, else `main` or `master`. */
	defaultBranch: string;
}

/** The main checkout of the repository `file` is in while it is on its default branch, or `null` for any other branch, a detached HEAD, a linked worktree, an isolated subagent's clone, or a file outside git. */
function mainCheckout(file: string): MainCheckout | null {
	let dir = dirname(file);
	while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
	const [gitDir, commonDir, top] = git(dir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"]).split("\n");
	if (!gitDir || gitDir !== commonDir || !top) return null;
	// omp clones the repository to `<base>/m` for an isolated subagent and marks `<base>` with its owner.
	if (existsSync(join(dirname(top), ".omp-isolation-owner.json"))) return null;
	const branch = git(top, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	const originHead = git(top, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, "");
	const defaults = originHead ? [originHead] : ["main", "master"];
	if (!defaults.includes(branch)) return null;
	return { top, graphite: existsSync(join(commonDir, ".graphite_repo_config")), defaultBranch: branch };
}

export default function worktreeGuard(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const guarded = targets(event.input as Record<string, unknown>).flatMap(path => {
			const file = resolve(ctx.cwd, path.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
			const main = mainCheckout(file);
			return main ? [{ file, main }] : [];
		});
		if (guarded.length === 0) return;
		// `git check-ignore` names an ignored path and stays silent for any other, including a tracked file an ignore rule matches.
		const unignored = guarded.find(({ file, main }) => git(main.top, ["check-ignore", "--", file]) === "");
		if (unignored) {
			const { main } = unignored;
			return {
				block: true,
				reason: [
					`${main.top} is the repository's main checkout, on its default branch \`${main.defaultBranch}\`.`,
					"Create a worktree on a new branch (`git worktree add -b <branch> ~/code/<repo>-wt/<topic> <parent>`) and make the change there.",
					...(main.graphite ? ["This repository uses Graphite: run `gt track <branch> -p <parent>` in the new worktree before you commit."] : []),
					"Edits on the default branch stay blocked, however often you retry. When the user asked you to work in place, switch the main checkout to a branch (`git switch -c <branch>`), then retry the call.",
				].join(" "),
			};
		}
		const files = guarded.map(({ file }) => `\`${file}\``).join(", ");
		const ignoredHere = `git ignores ${files}, so no worktree has it, and its main checkout is on the default branch.`;
		if (ctx.hasUI && (await ctx.ui.confirm("Edit an ignored file on the default branch?", `${ignoredHere} Allow this edit there?`))) return;
		return {
			block: true,
			reason: ctx.hasUI
				? `${ignoredHere} The user declined this edit. Ask the user how to proceed, and do not edit the file through the shell.`
				: `${ignoredHere} Editing it there needs the user's approval, which this session cannot ask for. Ask the user to make the change, and do not edit the file through the shell.`,
		};
	});
}
