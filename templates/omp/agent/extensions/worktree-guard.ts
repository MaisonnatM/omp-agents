// Holds back the first `edit` or `write` a session makes to a file in a repository's main checkout, so the agent
// makes its changes in a linked worktree, as AGENTS.md asks. A second attempt in the same repository goes through,
// for the user who asked to work in place. Files outside git, and internal URLs such as `local://`, pass.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** The files an `edit` or `write` call touches: its `path`, and each `[path#TAG]` header of a hashline edit. */
function targets(input: Record<string, unknown>): string[] {
	const paths = typeof input.path === "string" ? [input.path] : [];
	if (typeof input.input === "string") for (const match of input.input.matchAll(/^\[(.+)#[0-9A-Fa-f]{4}\]$/gm)) if (match[1]) paths.push(match[1]);
	return paths.filter(path => !path.includes("://"));
}

/** The main checkout of the repository `file` is in, or `null` when it sits in a linked worktree or outside git. */
function mainCheckout(file: string): string | null {
	let dir = dirname(file);
	while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
	try {
		const [gitDir, commonDir, top] = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.trim()
			.split("\n");
		return gitDir && gitDir === commonDir && top ? top : null;
	} catch {
		return null;
	}
}

export default function worktreeGuard(pi: ExtensionAPI) {
	/** Main checkouts this session was already warned about. */
	const warned = new Set<string>();
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		for (const path of targets(event.input as Record<string, unknown>)) {
			const main = mainCheckout(resolve(ctx.cwd, path.replace(/^~(?=\/)/, process.env.HOME ?? "~")));
			if (!main || warned.has(main)) continue;
			warned.add(main);
			return {
				block: true,
				reason: [
					`${main} is the repository's main checkout.`,
					"Create a worktree on a new branch (`git worktree add ../<repo>-<topic> -b <branch>`) and make the change there.",
					"When the user asked you to work in place, retry the same call; it goes through.",
				].join(" "),
			};
		}
	});
}
