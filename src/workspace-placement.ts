/**
 * Which workspace each session directory counts in: a linked worktree counts in its repository's main checkout. Git is asked
 * once per directory, and a directory git no longer knows, gone or left behind by a removed worktree, waits for a main
 * checkout seen since to claim it by its name, so it never lists as a workspace of its own.
 */
import { access } from "node:fs/promises";
import { basename } from "node:path";
import { mainCheckoutOf, type WorktreeAt } from "./git";
import { mapLimit, PROBE_PARALLEL } from "./map-limit";
import { workspaceFor } from "./paths";
import type { Workspace } from "./shared/workspaces";

/**
 * The main checkout among `mains` whose worktrees a directory `cwd` git no longer knows was likely one of: worktree tools name
 * them after it, as `<main>-<branch>` or `<main>-wt/<branch>`, where the longest match wins, so `app-web` beats `app` for
 * `app-web-fix`. Else, for a gone directory only, Codex's `<root>/<id>/<repository name>`: the one main checkout of that name,
 * none when two share it; a directory still there may be any folder that happens to share a repository's name.
 */
function mainCheckoutOfStray(cwd: string, gone: boolean, mains: Iterable<string>): string | null {
	let found: string | null = null;
	const named: string[] = [];
	for (const main of mains) {
		if (cwd.startsWith(`${main}-`) && (found === null || main.length > found.length)) found = main;
		if (basename(main) === basename(cwd)) named.push(main);
	}
	return found ?? (gone && named.length === 1 ? named[0]! : null);
}

export class WorkspacePlacement {
	/**
	 * The workspace each directory git was asked about counts in, `null` when it counts in itself; a resolved workspace stays after
	 * its worktree is removed. A directory outside any repository is `null` here until a main checkout claims it.
	 */
	readonly #workspaces = new Map<string, Workspace | null>();
	/** Directories outside any repository when git was asked, which no main checkout claimed yet, each with whether it was gone. */
	readonly #strays = new Map<string, boolean>();
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
			if (at === null) this.#strays.set(cwd, await access(cwd).then(() => false, () => true));
			const workspace = at?.linked && main !== null ? workspaceFor(main) : null;
			this.#workspaces.set(cwd, workspace);
			if (workspace) placed = true;
		});
		return this.#claimStrays() || placed;
	}

	/** {@link cwdOf} once `worktreeAt` placed `cwd`, so a worktree not asked about yet counts in its main checkout too. */
	async workspaceOf(cwd: string, worktreeAt: (dir: string) => Promise<WorktreeAt | null>): Promise<string> {
		await this.place([cwd], worktreeAt);
		return this.cwdOf(cwd);
	}

	/** Count each stray directory that a known main checkout claims in that checkout; returns whether any was claimed. */
	#claimStrays(): boolean {
		let claimed = false;
		for (const [cwd, gone] of this.#strays) {
			const main = mainCheckoutOfStray(cwd, gone, this.#mainCheckouts);
			if (main === null) continue;
			this.#strays.delete(cwd);
			this.#workspaces.set(cwd, workspaceFor(main));
			claimed = true;
		}
		return claimed;
	}
}
