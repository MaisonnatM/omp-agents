import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { type GhCredential, rejectedCredential, TOKEN_VARIABLE } from "../github/runner";
import { byReview, PROOF_BOX, type Review, type Reviews, type ReviewStage, REVIEW_STAGES, REVIEWS, type Stage, STAGES } from "./stages";

/** Whether a command's words open a PR that is not a draft, which the tool_call gate blocks. */
export function opensLivePr(words: string[]): boolean {
	const create = ghPr(words, "create");
	return create !== undefined && !create.some(a => a === "--draft" || a === "-d" || a.startsWith("--draft="));
}

/** The arguments of `gh pr <sub>` when the command's words run it, including any `-R` given before `<sub>`, else `undefined`. */
export function ghPr(words: string[], sub: "create" | "ready"): string[] | undefined {
	if (words[0] !== "gh" || words[1] !== "pr") return undefined;
	let i = 2;
	while (/^(?:-R|--repo(?:=|$))/.test(words[i] ?? "")) i += words[i] === "-R" || words[i] === "--repo" ? 2 : 1;
	return words[i] === sub ? [...words.slice(2, i), ...words.slice(i + 1)] : undefined;
}

/** The `gh pr view` selector for `gh pr ready <args>`: its first positional (number, URL, or branch) and `--repo`; redirections and other flags drop. */
export function prSelector(args: string[]): string[] {
	const repo: string[] = [];
	let positional: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const redirect = arg.match(/^(?:\d*|&)(?:>&|<&|>>|<<|>|<)(.*)$/);
		if (redirect) {
			// A bare operator such as `>` takes the next word as its target.
			if (!redirect[1]) i++;
		} else if (arg === "-R" || arg === "--repo") {
			if (i + 1 < args.length) repo.splice(0, 2, "--repo", args[++i]);
		} else if (/^(--repo=|-R)./.test(arg)) {
			repo.splice(0, 2, "--repo", arg.replace(/^(--repo=|-R)/, ""));
		} else if (!arg.startsWith("-")) {
			positional ??= arg;
		}
	}
	return positional === undefined ? repo : [positional, ...repo];
}

/** The owner a selector names through `--repo` (`owner/name`, `host/owner/name`, or a URL) or a pull request URL, else `undefined`. */
export function selectorOwner(selector: string[]): string | undefined {
	const flag = selector.indexOf("--repo");
	if (flag >= 0) {
		const parts = (selector[flag + 1] ?? "").replace(/^https?:\/\//, "").split("/").filter(Boolean);
		return parts.length >= 3 ? parts[1] : parts[0];
	}
	return selector[0]?.match(/^https?:\/\/[^/]+\/([^/]+)\/[^/]+\/pull\/\d+/)?.[1];
}

/** Whether `owner` differs from the owner of the repository `repo` (`owner/name`), case-insensitively; `false` when either is unknown. */
export function otherOwner(owner: string | undefined, repo: string | undefined): boolean {
	const own = repo?.split("/")[0];
	return owner !== undefined && own !== undefined && owner.toLowerCase() !== own.toLowerCase();
}

/** The most a PR may change and still take the fast path, which skips the arena and both reviews. */
export const FAST_PATH = { lines: 50, files: 3 } as const;
/** Paths of files that define a schema or a public interface, which never take the fast path whatever the diff's size. */
const INTERFACE_FILE = /(^|\/)(schema|openapi|swagger)[^/]*$|\.(proto|graphql|gql|sql|d\.ts)$|(^|\/)migrations?\/|(^|\/)package\.json$/i;

/** The globs of a paths file: one per line, where `#` starts a comment and blank lines are ignored. */
function globsOf(paths: string): Bun.Glob[] {
	return paths.split("\n").map(line => line.replace(/#.*/, "").trim()).filter(Boolean).map(glob => new Bun.Glob(glob));
}

/**
 * Whether a PR changing `files`, `changedFiles` in all, with `changedLines` added plus deleted, may take the fast path: at most `FAST_PATH.lines` lines in `FAST_PATH.files` files,
 * every one listed, none a schema or public-interface file, and none matching the shared contracts `reviewPaths`, the text of `.omp/review-paths`, lists.
 */
export function smallChange(files: string[], changedFiles: number, changedLines: number, reviewPaths: string | undefined): boolean {
	if (changedLines > FAST_PATH.lines || changedFiles > FAST_PATH.files || files.length < changedFiles) return false;
	const contracts = reviewPaths === undefined ? [] : globsOf(reviewPaths);
	return !files.some(file => INTERFACE_FILE.test(file) || contracts.some(glob => glob.match(file)));
}

/**
 * Whether a PR needs `review`: when the repository commits no `review.pathsFile` (`paths` is `undefined`), only if the review has `withoutPaths`;
 * else always when GitHub listed fewer `files` than the PR's `changedFiles`, and otherwise when a changed repository-relative path matches one of its globs.
 */
export function reviewNeeded(review: Review, paths: string | undefined, files: string[], changedFiles: number): boolean {
	if (paths === undefined) return review.withoutPaths;
	if (files.length < changedFiles) return true;
	const globs = globsOf(paths);
	return files.some(file => globs.some(glob => glob.match(file)));
}

/**
 * Each review's state for a PR with this body that changes `files`; `read` returns the text of a paths file in the checkout, `undefined` when it has none.
 * `changedLines`, the PR's added plus deleted lines, lets a small change skip both reviews on the fast path; while it is unknown, every review the paths call for stays needed.
 */
export function reviewsOf(body: string, files: string[], changedFiles: number, read: (pathsFile: string) => string | undefined, changedLines?: number): Reviews {
	const fast = changedLines !== undefined && smallChange(files, changedFiles, changedLines, read(REVIEWS.thermonuclear.pathsFile));
	return byReview(stage => ({
		needed: !fast && reviewNeeded(REVIEWS[stage], read(REVIEWS[stage].pathsFile), files, changedFiles),
		done: body.includes(REVIEWS[stage].box),
		...(fast ? { fastPath: true as const } : {}),
	}));
}

/** The reviews whose stages come before `stage`. */
export function reviewsBefore(stage: Stage): ReviewStage[] {
	return REVIEW_STAGES.filter(review => STAGES.indexOf(review) < STAGES.indexOf(stage));
}

/** The first review, in stage order, that runs before `stage` and that the PR needs without its box. */
function missingReview(reviews: Reviews, stage: Stage): ReviewStage | undefined {
	return reviewsBefore(stage).find(review => reviews[review].needed && !reviews[review].done);
}

/**
 * A reader returning the text of a paths file from the top of the checkout holding `dir`, or `undefined` when it has none.
 * A linked worktree without the file reads its main checkout's, so a paths file kept out of git, in `.git/info/exclude`, covers every worktree.
 */
export function checkoutReader(dir: string): (pathsFile: string) => string | undefined {
	let root: string | undefined;
	for (let at = dir; ; at = dirname(at)) {
		if (existsSync(join(at, ".git"))) {
			root = at;
			break;
		}
		if (dirname(at) === at) break;
	}
	const roots = root === undefined ? [] : [root];
	const main = root === undefined ? undefined : mainCheckoutOf(root);
	if (main !== undefined) roots.push(main);
	return pathsFile => {
		for (const at of roots) {
			const file = join(at, pathsFile);
			if (existsSync(file)) return readFileSync(file, "utf8");
		}
		return undefined;
	};
}

/** The main checkout of the linked worktree at `root`, read from its `.git` file's `gitdir: <main>/.git/worktrees/<name>`, or `undefined` for a main checkout. */
function mainCheckoutOf(root: string): string | undefined {
	const git = join(root, ".git");
	if (!statSync(git).isFile()) return undefined;
	const gitdir = /^gitdir: (.+)$/m.exec(readFileSync(git, "utf8"))?.[1]?.trim();
	const at = gitdir?.lastIndexOf("/.git/worktrees/") ?? -1;
	return gitdir !== undefined && at > 0 ? gitdir.slice(0, at) : undefined;
}

/**
 * Why a PR with this body may not go live, or `undefined` when it may: it needs the box of every review `reviews` calls for,
 * and no unchecked proof box while the interface review is needed, since only an interface change has a page to prove.
 */
export function publishBlocker(body: string, reviews: Reviews): string | undefined {
	const missing = missingReview(reviews, "live");
	if (missing) {
		const { label, box } = REVIEWS[missing];
		return `Blocked: the PR is not live until the ${label} stage is done. Run it, apply and push its fixes, then add \`${box}\` to the PR body.`;
	}
	if (reviews.interface_review.needed && body.split("\n").some(line => line.trimStart().startsWith(PROOF_BOX))) {
		return `Blocked: the PR body has an unchecked \`${PROOF_BOX}\` box from the repository's PR template, and a changed file matches \`${REVIEWS.interface_review.pathsFile}\`. Do what the box and the repository's instructions ask, then check it.`;
	}
	return undefined;
}

/**
 * Why GitHub rejects gh, or `undefined` when it accepts every credential gh uses: the credential and where it comes from, never a token.
 * `dotenvFiles` maps an environment variable to the project dotenv file its value came from.
 */
export function authDiagnosis(credentials: GhCredential[], dotenvFiles: Record<string, string>): string | undefined {
	const rejected = rejectedCredential(credentials);
	if (!rejected) return undefined;
	const login = `\`gh auth login -h ${rejected.host}\``;
	if (!TOKEN_VARIABLE.test(rejected.tokenSource)) {
		return `GitHub rejects gh's ${rejected.tokenSource} login${rejected.login ? ` for ${rejected.login}` : ""} on ${rejected.host}. Ask the user to run ${login}.`;
	}
	const file = dotenvFiles[rejected.tokenSource];
	return [
		`GitHub rejects the token in \`${rejected.tokenSource}\`, which gh uses for ${rejected.host}.`,
		file ? `omp read it from \`${file}\` when it started.` : "It is set in the environment omp started with.",
		`Ask the user to replace it there, or remove it and run ${login}, then restart the session.`,
	].join(" ");
}

/** The dotenv file in `dir` each environment variable's current value came from: Bun loads `.env` and its variants from the directory omp starts in, except variables the launch environment already set. */
export function dotenvFiles(dir: string): Record<string, string> {
	const files: Record<string, string> = {};
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !/^\.env(\..+)?$/.test(entry.name)) continue;
		const file = join(dir, entry.name);
		for (const [variable, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
			if (process.env[variable] === value) files[variable] ??= file;
		}
	}
	return files;
}
