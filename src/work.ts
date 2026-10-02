/**
 * Folds a transcript file's entries into what its agent planned and changed: the latest todo list, and the files its
 * `edit` and `write` calls changed. Only the file feeds it; omp writes each tool result as soon as it exists.
 */
import { isObject, str } from "./json";
import { displayPath } from "./paths";
import type { SessionWork, TodoItem, TodoPhase, TodoStatus } from "./shared";

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

/** The files one `edit` result changed: each of `perFileResults` for a multi-file edit, else the result itself. */
function editedFiles(details: Record<string, unknown>): { path: string; diff: string | null }[] {
	const results = Array.isArray(details.perFileResults) ? details.perFileResults : [details];
	return results.flatMap(result => {
		if (!isObject(result)) return [];
		const path = str(result.path);
		return path ? [{ path, diff: str(result.diff) || null }] : [];
	});
}

export class Work {
	/** The transcript's working directory, from its `session` header. */
	#cwd: string | null = null;
	#phases: TodoPhase[] = [];
	/** By the path omp reported, in first-touch order. */
	readonly #files = new Map<string, { edits: number; diff: string | null }>();

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
		if (message.role !== "toolResult" || message.isError === true) return false;
		const details = isObject(message.details) ? message.details : {};
		switch (message.toolName) {
			case "todo":
				return details.op !== "view" && this.#plan(details.phases);
			case "edit":
				return this.#touch(editedFiles(details));
			case "write": {
				// Only a write to a file names one; a write to a device such as `xd://` or `agent://` does not.
				const path = str(details.resolvedPath);
				return path ? this.#touch([{ path, diff: null }]) : false;
			}
			default:
				return false;
		}
	}

	snapshot(): SessionWork {
		return { phases: this.#phases, files: [...this.#files].map(([path, file]) => ({ path: this.#display(path), ...file })) };
	}

	#plan(value: unknown): boolean {
		const phases = parsePhases(value);
		if (!phases) return false;
		this.#phases = phases;
		return true;
	}

	#touch(changes: { path: string; diff: string | null }[]): boolean {
		for (const { path, diff } of changes) {
			const file = this.#files.get(path);
			this.#files.set(path, { edits: (file?.edits ?? 0) + 1, diff });
		}
		return changes.length > 0;
	}

	#display(path: string): string {
		const cwd = this.#cwd;
		return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : displayPath(path);
	}
}
