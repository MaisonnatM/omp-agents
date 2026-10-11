/**
 * The changes view's reads: the files a session's checkout changed against its branch base, merged with the files the
 * session's own `edit` and `write` calls changed, and each such file in full with its diff. The page names a file by the
 * path the list gave it, and the server reads only a path the list holds.
 */
import { join, relative } from "node:path";
import { createCache } from "./cache";
import { git } from "./git";
import { LineReader } from "./line-reader";
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

/** A transcript folded as far as it has been read: only the lines appended since the last read are parsed. */
class FoldedTranscript {
	#work = new Work();
	readonly #reader: LineReader;
	/** Reads one after another, so two callers never fold the same appended lines twice. */
	#chain: Promise<unknown> = Promise.resolve();

	constructor(file: string) {
		this.#reader = new LineReader(file, () => {
			this.#work = new Work();
		});
	}

	/** The absolute paths the transcript's `edit` and `write` calls changed, in first-touch order. */
	paths(): Promise<string[]> {
		const next = this.#chain.then(async () => {
			await this.#reader.read(line => {
				try {
					this.#work.applyEntry(JSON.parse(line));
				} catch {
					/* A line that is not JSON is not an entry. */
				}
			});
			return this.#work.paths();
		});
		this.#chain = next.catch(() => {});
		return next;
	}
}

/** The most transcripts kept folded; the oldest is forgotten first. */
const MAX_FOLDED = 32;
const folded = new Map<string, FoldedTranscript>();

function sessionPaths(file: string): Promise<string[]> {
	let transcript = folded.get(file);
	if (!transcript) {
		if (folded.size >= MAX_FOLDED) folded.delete(folded.keys().next().value!);
		transcript = new FoldedTranscript(file);
		folded.set(file, transcript);
	}
	return transcript.paths();
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
async function scan(place: SessionPlace): Promise<LocatedList> {
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

interface LocatedList {
	changes: SessionChanges;
	files: Located[];
}

/** The last list of each place for a few seconds, so opening several files of one list scans the checkout once. */
const lists = createCache<LocatedList>(3_000);

const placeKey = (place: SessionPlace): string => `${place.file}\0${place.dir}`;

/** `listChanges` always scans anew and keeps the answer for the file reads that follow it. */
export async function listChanges(place: SessionPlace): Promise<SessionChanges> {
	return (await lists.get(placeKey(place), () => scan(place), true)).changes;
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

/** The file of the list at `path`, with every line of its diff; `null` when the list holds no such path. The list is the one `listChanges` last made, up to three seconds old. */
export async function readChangedFile(place: SessionPlace, path: string): Promise<ChangedFileText | null> {
	const { changes, files } = await lists.get(placeKey(place), () => scan(place));
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
