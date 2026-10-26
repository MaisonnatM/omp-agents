/**
 * Which code a server serves: the checkout it read at startup and the page it built from it, so a smoke check can
 * prove it verifies the code its checkout holds now rather than a server started before the last edit or from another checkout.
 */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical } from "./git";
import { run, runChecked } from "./proc";

/** The code a checkout holds right now, as git sees it. */
export interface SourceIdentity {
	/** `git rev-parse --show-toplevel`, symlinks resolved. */
	checkout: string;
	/** `null` on a detached HEAD. */
	branch: string | null;
	/** HEAD, `null` before the first commit. */
	commit: string | null;
	/** The tree of the working tree as `git add -A` would stage it: tracked edits and untracked files that are not ignored included. */
	tree: string;
}

/** What `GET /api/dashboard/build` answers: the source the server read at startup and the page it built from it. */
export interface ServedBuild {
	/** `null` for the packaged app's prebuilt page or a server outside git. */
	source: SourceIdentity | null;
	/** `pageBuild` of the served page, from `src/server/page.ts`. */
	page: string;
	pid: number;
	/** ISO time the server read its source. */
	startedAt: string;
}

/** Whether a server serves the code a local checkout holds now. */
export type Provenance =
	| { kind: "match" }
	| { kind: "unknown" }
	| { kind: "other-checkout"; served: string; local: string }
	/** Same checkout, other trees: the checkout changed since the server read it, so restart the server. */
	| { kind: "stale"; served: string; local: string };

const GIT_TIMEOUT_MS = 30_000;

/**
 * The tree `git add -A` would stage in `checkout`, staged into a copy of its index, so the real index and its
 * `index.lock` stay untouched and a concurrent git command never finds them taken.
 */
async function workingTree(checkout: string): Promise<string> {
	const index = (await runChecked(["git", "-C", checkout, "rev-parse", "--path-format=absolute", "--git-path", "index"], { timeoutMs: GIT_TIMEOUT_MS })).trim();
	const scratch = await mkdtemp(join(tmpdir(), "omp-agents-tree-"));
	const opts = { timeoutMs: GIT_TIMEOUT_MS, env: { GIT_INDEX_FILE: join(scratch, "index") } };
	try {
		// A repository nothing was ever added to has no index yet; `git add` starts one.
		await copyFile(index, opts.env.GIT_INDEX_FILE).catch((err: NodeJS.ErrnoException) => {
			if (err.code !== "ENOENT") throw err;
		});
		await runChecked(["git", "-C", checkout, "add", "-A"], opts);
		return (await runChecked(["git", "-C", checkout, "write-tree"], opts)).trim();
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/** What the checkout `dir` is in holds now, `null` when `dir` is in none. */
export async function readSourceIdentity(dir: string): Promise<SourceIdentity | null> {
	const top = await run(["git", "-C", dir, "rev-parse", "--show-toplevel"], { timeoutMs: GIT_TIMEOUT_MS });
	if (top.code !== 0) return null;
	const checkout = await canonical(top.stdout.trim());
	const [branch, commit, tree] = await Promise.all([
		run(["git", "-C", checkout, "symbolic-ref", "--quiet", "--short", "HEAD"], { timeoutMs: GIT_TIMEOUT_MS }),
		run(["git", "-C", checkout, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { timeoutMs: GIT_TIMEOUT_MS }),
		workingTree(checkout),
	]);
	return {
		checkout,
		branch: branch.code === 0 ? branch.stdout.trim() : null,
		commit: commit.code === 0 ? commit.stdout.trim() : null,
		tree,
	};
}

/** Whether `served` serves what `local` holds: the same checkout with the same working tree. */
export function provenance(served: ServedBuild, local: SourceIdentity): Provenance {
	const { source } = served;
	if (!source) return { kind: "unknown" };
	if (source.checkout !== local.checkout) return { kind: "other-checkout", served: source.checkout, local: local.checkout };
	if (source.tree !== local.tree) return { kind: "stale", served: source.tree, local: local.tree };
	return { kind: "match" };
}

/** `<checkout> <branch>@<commit>, tree <tree>`, ids shortened. */
export const describeSource = ({ checkout, branch, commit, tree }: SourceIdentity): string =>
	`${checkout} ${branch ?? "detached"}@${commit?.slice(0, 7) ?? "no commit"}, tree ${tree.slice(0, 7)}`;

/** What the server's startup line and a smoke report say it serves: its source, as {@link describeSource} says, and its page. */
export const describeServed = ({ source, page }: ServedBuild): string => (source ? `${describeSource(source)}, page ${page}` : `page ${page} from no git checkout`);
