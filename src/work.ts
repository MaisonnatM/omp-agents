/**
 * Folds a transcript file's entries into the files its agent's `edit` and `write` calls changed. Only the file feeds
 * it; omp writes each tool result as soon as it exists.
 */
import { isObject, str } from "./json";
import { displayPath } from "./paths";
import { entryTime, toolCallsOf, toolResultOf } from "./session-entries";
import { type ChangedFile, type FileChange, parseDiffLine } from "./shared";

/** omp's edit operations (`pi-tui/src/tools/edit.ts`); an edit without one updates the file. */
const EDIT_KINDS: Record<string, "created" | "edited" | "deleted"> = { create: "created", update: "edited", delete: "deleted" };

/** Lines in a written file; a trailing newline ends the last line rather than starting another. */
const lineCount = (text: string): number => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/** Lines that omp's numbered diff adds and removes. */
function diffCounts(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		const sign = parseDiffLine(line)?.sign;
		if (sign === "+") added++;
		else if (sign === "-") removed++;
	}
	return { added, removed };
}

/** The files one `edit` result changed: each of `perFileResults` that succeeded for a multi-file edit, else the result itself. */
function editedFiles(details: Record<string, unknown>, at: number | null): [string, FileChange][] {
	const results = Array.isArray(details.perFileResults) ? details.perFileResults : [details];
	return results.flatMap((result): [string, FileChange][] => {
		if (!isObject(result) || result.isError === true) return [];
		const path = str(result.path);
		if (!path) return [];
		const op = str(result.op);
		const diff = str(result.diff) || null;
		const kind = op && Object.hasOwn(EDIT_KINDS, op) ? EDIT_KINDS[op] : "edited";
		return [[path, { tool: "edit", kind, at, ...diffCounts(diff ?? ""), diff }]];
	});
}

export class Work {
	/** The transcript's working directory, from its `session` header. */
	#cwd: string | null = null;
	/** Each file's changes, oldest first, by the path omp reported, in first-touch order. */
	readonly #files = new Map<string, FileChange[]>();
	/** Paths whose changes grew since the last {@link takeChanged}. */
	readonly #changed = new Set<string>();
	/** Paths a `read` result named, so a later write to one rewrites the file rather than creates it. */
	readonly #read = new Set<string>();
	/** Lines of each `write` call's content, by tool call id, until its result arrives. */
	readonly #writing = new Map<string, number>();

	/** One session-file entry. */
	applyEntry(entry: unknown): void {
		if (!isObject(entry)) return;
		if (entry.type === "session") {
			this.#cwd = str(entry.cwd) ?? null;
			return;
		}
		if (entry.type !== "message" || !isObject(entry.message)) return;
		this.#noteWrites(entry.message);
		const result = toolResultOf(entry.message);
		if (!result) return;
		const written = this.#takeWrite(result.callId);
		if (result.isError) return;
		const { details } = result;
		switch (result.toolName) {
			case "read": {
				const path = str(details.resolvedPath);
				if (path) this.#read.add(path);
				return;
			}
			case "edit":
				this.#touch(editedFiles(details, entryTime(entry)));
				return;
			case "write": {
				// Only a write to a file names one; a write to a device such as `xd://` or `agent://` does not.
				const path = str(details.resolvedPath);
				if (path) this.#touch([[path, this.#written(path, written, entryTime(entry))]]);
				return;
			}
		}
	}

	/** Every changed file, in first-touch order. */
	files(): ChangedFile[] {
		return [...this.#files].map(([path, changes]) => this.#file(path, changes));
	}

	/** The files whose changes grew since the last call, in first-touch order. */
	takeChanged(): ChangedFile[] {
		const files = [...this.#files].filter(([path]) => this.#changed.has(path)).map(([path, changes]) => this.#file(path, changes));
		this.#changed.clear();
		return files;
	}

	/** Keeps the line count of each `write` call in an assistant message, which its result does not repeat. */
	#noteWrites(message: Record<string, unknown>): void {
		for (const { id, name, args } of toolCallsOf(message)) {
			const text = str(args.content);
			if (name === "write" && text !== undefined) this.#writing.set(id, lineCount(text));
		}
	}

	/** The lines a `write` call carried, forgotten once its result arrives; `null` when the transcript lacks the call. */
	#takeWrite(callId: unknown): number | null {
		const id = str(callId);
		if (id === undefined) return null;
		const lines = this.#writing.get(id) ?? null;
		this.#writing.delete(id);
		return lines;
	}

	/** A write creates a file the transcript never read or changed, or one it deleted last; else it rewrites it. */
	#written(path: string, lines: number | null, at: number | null): FileChange {
		const last = this.#files.get(path)?.at(-1);
		const created = last ? last.kind === "deleted" : !this.#read.has(path);
		return { tool: "write", kind: created ? "created" : "rewritten", at, lines };
	}

	#touch(touches: [string, FileChange][]): void {
		for (const [path, change] of touches) {
			const changes = this.#files.get(path);
			if (changes) changes.push(change);
			else this.#files.set(path, [change]);
			this.#changed.add(path);
		}
	}

	#file(path: string, changes: FileChange[]): ChangedFile {
		const cwd = this.#cwd;
		return { path: cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : displayPath(path), changes };
	}
}
