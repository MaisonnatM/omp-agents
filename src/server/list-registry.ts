/** Whole-list snapshots and edits: one registration owns each message builder and its store's reducer. */
import type { RoutineChange } from "../routines";
import type { PinChange } from "../shared/pins";
import type { ProjectEdit } from "../shared/projects";
import type { ServerMsg } from "../shared/protocol";
import type { ReviewDraftEdit } from "../shared/review-drafts";
import type { ReviewTriageEdit } from "../shared/review-triage";
import type { ScheduledChange } from "../shared/scheduled";
import type { WorkspaceChange } from "../shared/workspaces";
import type { UserTodoChange } from "../user-todos-shared";
import type { Peer } from "./request-ledger";

interface ListChanges {
	"user-todos": UserTodoChange;
	routines: Exclude<RoutineChange, { op: "run-now" }>;
	scheduled: Exclude<ScheduledChange, { op: "send-now" }>;
	workspaces: WorkspaceChange;
	pins: PinChange;
	projects: ProjectEdit;
	"review-drafts": ReviewDraftEdit;
	"review-triages": ReviewTriageEdit;
}

/** The lists only the server changes, through actions of their own: the bell's notices, the queued merges, and the design comparisons. */
type ReadOnlyKind = "notices" | "merges" | "comparisons";
export type ListKind = keyof ListChanges | ReadOnlyKind;
export type ListMessage<T extends ListKind = ListKind> = Extract<ServerMsg, { t: T }>;
type EditableEntries = {
	[T in keyof ListChanges]: { msg(): ListMessage<T>; apply(change: ListChanges[T]): boolean };
};
type ListEntries = EditableEntries & { [T in ReadOnlyKind]: { msg(): ListMessage<T> } };
export class ListRegistry {
	readonly #entries: ListEntries;
	readonly #snapshots: { msg(): ListMessage }[];
	readonly #push: (kind: ListKind) => void;

	constructor(entries: ListEntries, push: (kind: ListKind) => void) {
		this.#entries = entries;
		this.#snapshots = Object.values(entries);
		this.#push = push;
	}

	message(kind: ListKind): ListMessage {
		return this.#entries[kind].msg();
	}

	/** Current whole lists, including ones that have never changed or been published. */
	*messages(): Iterable<ListMessage> {
		for (const entry of this.#snapshots) yield entry.msg();
	}

	/** Publish a changed list; a no-op instead resends the current list to the requesting page alone. */
	apply<T extends keyof ListChanges>(kind: T, change: ListChanges[T], peer?: Pick<Peer, "send">): boolean {
		const entries: EditableEntries = this.#entries;
		const changed = entries[kind].apply(change);
		if (changed) this.#push(kind);
		else peer?.send(this.message(kind));
		return changed;
	}
}
