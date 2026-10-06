/**
 * The changes view's reads: the files a session's checkout changed against its branch base, merged with the files the
 * session's own `edit` and `write` calls changed, and each such file in full with its diff. The page names a file by the
 * path the list gave it, and the server reads only a path the list holds.
 */
import { stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { git } from "./git";
import { displayPath } from "./paths";
import { run } from "./proc";
import { type ChangedEntry, type ChangedFileText, type ChangeStatus, contextRows, MAX_CHANGED_FILE_BYTES, parseFullDiff, type SessionChanges } from "./shared/changes";
import { Work } from "./work";

/** Where a session works: its transcript, and the directory its checkout is read from (its worktree, else its cwd). */
export interface SessionPlace {
	file: string;
	dir: string;
}

/** A file of the list with the absolute path it names. */
type Located = ChangedEntry & { absolute: string };

const STATUS: Record<string, ChangeStatus> = { A: "added", M: "modified", D: "deleted", T: "modified" };

/** Each transcript's folded {@link Work}, kept while its size and time stay the same. */
const folded = new Map<string, { size: number; mtimeMs: number; paths: string[] }>();

/** The absolute paths the transcript's `edit` and `write` calls changed, in first-touch order. */
async function sessionPaths(file: string): Promise<string[]> {
	const info = await stat(file).catch(() => null);
	if (!info) return [];
	const known = folded.get(file);
	if (known && known.size === info.size && known.mtimeMs === info.mtimeMs) return known.paths;
	const work = new Work();
	for (const line of (await Bun.file(file).text()).split("\n")) {
		if (!line) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		work.applyEntry(entry);
	}
	const paths = work.paths();
	if (folded.size > 32) folded.delete(folded.keys().next().value!);
	folded.set(file, { size: info.size, mtimeMs: info.mtimeMs, paths });
	return paths;
}

/**
 * The checkout `dir` is in, with the commit its branch forked from the remote's default branch, else `HEAD`, else the
 * empty tree while the branch has no commit; `null` outside git.
 */
async function checkoutOf(dir: string): Promise<{ root: string; branch: string | null; base: { ref: string; sha: string } } | null> {
	const top = await run(["git", "-C", dir, "rev-parse", "--show-toplevel"]).catch(() => null);
	if (!top || top.code !== 0) return null;
	const root = top.stdout.trim();
	const [branch, remoteHead, head] = await Promise.all([
		run(["git", "-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"]),
		run(["git", "-C", root, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
		run(["git", "-C", root, "rev-parse", "--verify", "--quiet", "HEAD"]),
	]);
	const branchName = branch.code === 0 ? branch.stdout.trim() : null;
	if (head.code !== 0) return { root, branch: branchName, base: { ref: "no commit", sha: (await git(root, "hash-object", "-t", "tree", "/dev/null")).trim() } };
	const forked = remoteHead.code === 0 ? await run(["git", "-C", root, "merge-base", "HEAD", remoteHead.stdout.trim()]) : null;
	const base = forked?.code === 0 ? { ref: remoteHead.stdout.trim(), sha: forked.stdout.trim() } : { ref: "HEAD", sha: head.stdout.trim() };
	return { root, branch: branchName, base };
}

/** Lines of a file that is at most {@link MAX_CHANGED_FILE_BYTES}; `null` for a larger or binary one. */
async function lineCount(path: string): Promise<number | null> {
	const file = Bun.file(path);
	if (file.size > MAX_CHANGED_FILE_BYTES) return null;
	const bytes = await file.bytes().catch(() => null);
	if (!bytes || bytes.includes(0)) return null;
	let lines = 0;
	for (const byte of bytes) if (byte === 10) lines++;
	return bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? lines + 1 : lines;
}

/** Git's changes in `root` against `sha`, tracked and untracked, in path order. */
async function gitChanges(root: string, sha: string): Promise<Located[]> {
	const [names, counts, untracked] = await Promise.all([
		git(root, "diff", "--name-status", "-z", "--no-renames", sha),
		git(root, "diff", "--numstat", "-z", "--no-renames", sha),
		git(root, "ls-files", "--others", "--exclude-standard", "-z"),
	]);
	const numstat = new Map<string, { added: number | null; removed: number | null }>();
	for (const row of counts.split("\0")) {
		const [added, removed, path] = row.split("\t");
		if (path) numstat.set(path, { added: added === "-" ? null : Number(added), removed: removed === "-" ? null : Number(removed) });
	}
	const files: Located[] = [];
	const fields = names.split("\0");
	for (let index = 0; index + 1 < fields.length; index += 2) {
		const path = fields[index + 1]!;
		files.push({ path, status: STATUS[fields[index]![0]!] ?? "modified", added: null, removed: null, ...numstat.get(path), session: false, absolute: join(root, path) });
	}
	const untrackedPaths = untracked.split("\0").filter(Boolean);
	const lines = await Promise.all(untrackedPaths.map(path => lineCount(join(root, path))));
	untrackedPaths.forEach((path, index) => files.push({ path, status: "untracked", added: lines[index]!, removed: 0, session: false, absolute: join(root, path) }));
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** The list with each entry's absolute path, which the file read checks a request against. */
async function locate(place: SessionPlace): Promise<{ changes: SessionChanges; files: Located[] }> {
	const [checkout, touched] = await Promise.all([checkoutOf(place.dir), sessionPaths(place.file)]);
	const files = checkout ? await gitChanges(checkout.root, checkout.base.sha) : [];
	const byPath = new Map(files.map(file => [file.absolute, file]));
	for (const absolute of touched) {
		const listed = byPath.get(absolute);
		if (listed) {
			listed.session = true;
			continue;
		}
		const inside = checkout && absolute.startsWith(`${checkout.root}/`);
		const entry: Located = { path: inside ? relative(checkout.root, absolute) : displayPath(absolute), status: null, added: null, removed: null, session: true, absolute };
		byPath.set(absolute, entry);
		files.push(entry);
	}
	const changes: SessionChanges = {
		root: checkout?.root ?? null,
		branch: checkout?.branch ?? null,
		base: checkout?.base ?? null,
		files: files.map(({ absolute: _, ...entry }) => entry),
	};
	return { changes, files };
}

export async function listChanges(place: SessionPlace): Promise<SessionChanges> {
	return (await locate(place)).changes;
}

/** Bytes of a side as UTF-8 text, or why it does not show. */
function decode(bytes: Uint8Array): { text: string } | { note: string } {
	if (bytes.includes(0)) return { note: "Binary file" };
	try {
		return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
	} catch {
		return { note: "Not UTF-8 text" };
	}
}

/** The file of the list at `path`, with every line of its diff; `null` when the list holds no such path. */
export async function readChangedFile(place: SessionPlace, path: string): Promise<ChangedFileText | null> {
	const { changes, files } = await locate(place);
	const entry = files.find(file => file.path === path);
	if (!entry) return null;
	const shown = (rows: ChangedFileText["rows"], note: string | null = null): ChangedFileText => ({ path, rows, note });
	const current = Bun.file(entry.absolute);
	const exists = await current.exists();
	if (exists && current.size > MAX_CHANGED_FILE_BYTES) return shown(null, `Too large to show: ${Math.round(current.size / 1024)} KB`);
	if (changes.root && changes.base && entry.status !== null) {
		const argv =
			entry.status === "untracked"
				? ["git", "-C", changes.root, "diff", "--no-index", "--no-color", "--no-ext-diff", "--unified=100000000", "--", "/dev/null", entry.path]
				: // Literal, so a path such as `app/[id]/page.tsx` names that one file rather than a glob that can match another.
					["git", "--literal-pathspecs", "-C", changes.root, "diff", "--no-color", "--no-ext-diff", "--histogram", "--unified=100000000", changes.base.sha, "--", entry.path];
		const diff = await run(argv, { timeoutMs: 10000 });
		if (diff.code > 1) return shown(null, diff.stderr.trim() || "git could not compare this file");
		if (/^Binary files /m.test(diff.stdout)) return shown(null, "Binary file");
		return shown(parseFullDiff(diff.stdout));
	}
	if (!exists) return shown(null, "Deleted");
	const read = decode(await current.bytes());
	return "text" in read ? shown(contextRows(read.text)) : shown(null, read.note);
}
