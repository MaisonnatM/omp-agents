/**
 * Folds a transcript file's entries into what its agent planned and changed: the latest todo list, and the files its
 * `edit` and `write` calls changed. Only the file feeds it; omp writes each tool result as soon as it exists.
 */
import { isObject, str } from "./json";
import { displayPath } from "./paths";
import { type FileChange, parseDiffLine, type SessionWork, type TodoItem, type TodoPhase, type TodoStatus } from "./shared";

/** omp's rule for a plan file (`listPlanFiles` in `pi-coding-agent/src/plan-mode/plan-files.ts`): a name ending in `plan.md`, such as `local://auth-plan.md`. */
const PLAN_FILE = /plan\.md$/i;

/** omp's custom entry for a todo list the user edited in its terminal (`USER_TODO_EDIT_CUSTOM_TYPE`). */
const USER_TODO_EDIT = "user_todo_edit";

const TODO_STATUSES: Record<TodoStatus, true> = { pending: true, in_progress: true, completed: true, abandoned: true, blocked: true };

const isTodoStatus = (value: unknown): value is TodoStatus => typeof value === "string" && Object.hasOwn(TODO_STATUSES, value);

/** A todo list as omp persists it, or `null` when any part is malformed, as omp's own `isTodoPhase` rejects it. */
function parsePhases(value: unknown): TodoPhase[] | null {
	if (!Array.isArray(value)) return null;
	const phases: TodoPhase[] = [];
	for (const phase of value) {
		if (!isObject(phase) || typeof phase.name !== "string" || !Array.isArray(phase.tasks)) return null;
		const tasks: TodoItem[] = [];
		for (const task of phase.tasks) {
			if (!isObject(task) || typeof task.content !== "string" || !isTodoStatus(task.status)) return null;
			tasks.push({ content: task.content, status: task.status });
		}
		phases.push({ name: phase.name, tasks });
	}
	return phases;
}

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

/** An entry's ISO `timestamp` in ms since the epoch, or `null` when it has none. */
function entryTime(entry: Record<string, unknown>): number | null {
	const at = Date.parse(str(entry.timestamp) ?? "");
	return Number.isFinite(at) ? at : null;
}

export class Work {
	/** The transcript's working directory, from its `session` header. */
	#cwd: string | null = null;
	#phases: TodoPhase[] = [];
	/** Each file's changes, oldest first, by the path omp reported, in first-touch order. */
	readonly #files = new Map<string, FileChange[]>();
	/** Paths a `read` result named, so a later write to one rewrites the file rather than creates it. */
	readonly #read = new Set<string>();
	/** Lines of each `write` call's content, by tool call id, until its result arrives. */
	readonly #writing = new Map<string, number>();
	#planFile: string | null = null;
	#planVersion = 0;

	/** One session-file entry. Returns whether the plan or the changed files changed. */
	applyEntry(entry: unknown): boolean {
		if (!isObject(entry)) return false;
		if (entry.type === "session") {
			this.#cwd = str(entry.cwd) ?? null;
			return false;
		}
		if (entry.type === "custom" && entry.customType === USER_TODO_EDIT) return this.#plan(isObject(entry.data) ? entry.data.phases : undefined);
		if (entry.type !== "message" || !isObject(entry.message)) return false;
		const message = entry.message;
		if (message.role === "assistant") {
			this.#noteWrites(message.content);
			return false;
		}
		if (message.role !== "toolResult") return false;
		const written = this.#takeWrite(message.toolCallId);
		if (message.isError === true) return false;
		const details = isObject(message.details) ? message.details : {};
		switch (message.toolName) {
			case "todo":
				return details.op !== "view" && this.#plan(details.phases);
			case "read": {
				const path = str(details.resolvedPath);
				if (path) this.#read.add(path);
				return false;
			}
			case "edit":
				return this.#touch(editedFiles(details, entryTime(entry)));
			case "write": {
				// Only a write to a file names one; a write to a device such as `xd://` or `agent://` does not.
				const path = str(details.resolvedPath);
				return path ? this.#touch([[path, this.#written(path, written, entryTime(entry))]]) : false;
			}
			default:
				return false;
		}
	}

	/** The plan file the agent wrote or edited last, as omp resolved it, or `null` when it wrote none or deleted that one. */
	get planFile(): string | null {
		return this.#planFile;
	}

	/** Counts every change to a plan file, so a reader knows when to read {@link planFile} again. */
	get planVersion(): number {
		return this.#planVersion;
	}

	/** `planText` is {@link planFile}'s text, `null` when it could not be read. */
	snapshot(planText: string | null = null): SessionWork {
		const planFile = this.#planFile;
		return {
			phases: this.#phases,
			files: [...this.#files].map(([path, changes]) => ({ path: this.#display(path), changes })),
			plan: planFile !== null && planText !== null ? { path: this.#display(planFile), text: planText } : null,
		};
	}

	/** Keeps the line count of each `write` call in an assistant message, which its result does not repeat. */
	#noteWrites(content: unknown): void {
		if (!Array.isArray(content)) return;
		for (const part of content) {
			if (!isObject(part) || part.type !== "toolCall" || part.name !== "write" || !isObject(part.arguments)) continue;
			const id = str(part.id);
			const text = str(part.arguments.content);
			if (id !== undefined && text !== undefined) this.#writing.set(id, lineCount(text));
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

	#plan(value: unknown): boolean {
		const phases = parsePhases(value);
		if (!phases) return false;
		this.#phases = phases;
		return true;
	}

	#touch(touches: [string, FileChange][]): boolean {
		for (const [path, change] of touches) {
			if (PLAN_FILE.test(path)) {
				if (change.kind !== "deleted") this.#planFile = path;
				else if (path === this.#planFile) this.#planFile = null;
				this.#planVersion++;
			}
			const changes = this.#files.get(path);
			if (changes) changes.push(change);
			else this.#files.set(path, [change]);
		}
		return touches.length > 0;
	}

	#display(path: string): string {
		const cwd = this.#cwd;
		return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : displayPath(path);
	}
}
