/**
 * Which workspace each session directory counts in: a linked worktree counts in its repository's main checkout. Git is asked
 * once per directory, and a directory already gone when asked waits for a main checkout seen since to claim it by its name.
 */
import { access } from "node:fs/promises";
import { basename } from "node:path";
import { mainCheckoutOf, type WorktreeAt } from "./git";
import { mapLimit, PROBE_PARALLEL } from "./map-limit";
import { workspaceFor } from "./paths";
import type { Workspace } from "./shared/workspaces";

/**
 * The main checkout among `mains` whose worktrees a gone directory `cwd` was likely one of: worktree tools name them after it,
 * as `<main>-<branch>` or `<main>-wt/<branch>`, where the longest match wins, so `app-web` beats `app` for `app-web-fix`.
 * Else Codex's `<root>/<id>/<repository name>`: the one main checkout of that name, none when two share it.
 */
function mainCheckoutOfGone(cwd: string, mains: Iterable<string>): string | null {
	let found: string | null = null;
	const named: string[] = [];
	for (const main of mains) {
		if (cwd.startsWith(`${main}-`) && (found === null || main.length > found.length)) found = main;
		if (basename(main) === basename(cwd)) named.push(main);
	}
	return found ?? (named.length === 1 ? named[0]! : null);
}

export class WorkspacePlacement {
	/**
	 * The workspace each directory git was asked about counts in, `null` when it counts in itself; a resolved workspace stays after
	 * its worktree is removed. A directory that was gone when asked is `null` here until a main checkout claims it.
	 */
	readonly #workspaces = new Map<string, Workspace | null>();
	/** Directories that were gone when git was asked, which no main checkout claimed yet. */
	readonly #gone = new Set<string>();
	/** The main checkout of every repository an asked directory was in. */
	readonly #mainCheckouts = new Set<string>();

	/** The workspace `cwd` counts in as git last answered, the same object until that answer changes; `null` while git was not asked, or when it counts in itself. */
	at(cwd: string): Workspace | null {
		return this.#workspaces.get(cwd) ?? null;
	}

	/** The directory of the workspace `cwd` counts in: {@link at}'s, else `cwd` itself. */
	readonly cwdOf = (cwd: string): string => this.#workspaces.get(cwd)?.cwd ?? cwd;

	/** Ask `worktreeAt` which workspace each of `cwds` not asked about yet counts in; returns whether any workspace changed. */
	async place(cwds: readonly string[], worktreeAt: (dir: string) => Promise<WorktreeAt | null>): Promise<boolean> {
		const unasked = [...new Set(cwds)].filter(cwd => !this.#workspaces.has(cwd));
		let placed = false;
		await mapLimit(unasked, PROBE_PARALLEL, async cwd => {
			const at = await worktreeAt(cwd);
			const main = at && mainCheckoutOf(at);
			if (main !== null) this.#mainCheckouts.add(main);
			if (at === null && (await access(cwd).then(() => false, () => true))) this.#gone.add(cwd);
			const workspace = at?.linked && main !== null ? workspaceFor(main) : null;
			this.#workspaces.set(cwd, workspace);
			if (workspace) placed = true;
		});
		return this.#claimGone() || placed;
	}

	/** Count each gone directory that a known main checkout claims in that checkout; returns whether any was claimed. */
	#claimGone(): boolean {
		let claimed = false;
		for (const cwd of this.#gone) {
			const main = mainCheckoutOfGone(cwd, this.#mainCheckouts);
			if (main === null) continue;
			this.#gone.delete(cwd);
			this.#workspaces.set(cwd, workspaceFor(main));
			claimed = true;
		}
		return claimed;
	}
}
