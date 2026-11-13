/** Whole-list snapshots and edits: one registration owns each message builder and its store's reducer. */
import type { ModuleChanges, ModuleFiles, StoredModuleId } from "../modules";
import type { RoutineChange } from "../routines";
import type { BotChange } from "../shared/bots";
import type { PinChange } from "../shared/pins";
import type { PreferenceChange } from "../shared/preferences";
import type { ModuleMsg, ServerMsg } from "../shared/protocol";
import type { ReviewDraftEdit } from "../shared/review-drafts";
import type { TrustChange } from "../shared/project-trust";
import type { ScheduledChange } from "../shared/scheduled";
import type { WorkspaceChange } from "../shared/workspaces";
import type { UserTodoChange } from "../user-todos-shared";
import type { Peer } from "./request-ledger";

interface ListChanges {
	"user-todos": UserTodoChange;
	routines: Exclude<RoutineChange, { op: "run-now" }>;
	scheduled: Exclude<ScheduledChange, { op: "send-now" }>;
	workspaces: WorkspaceChange;
	"project-trust": TrustChange;
	pins: PinChange;
	"review-drafts": ReviewDraftEdit;
	preferences: PreferenceChange;
	bots: Exclude<BotChange, { op: "message" | "restart" }>;
}

/** The lists only the server changes, through actions of their own: the bell's notices and the queued merges. */
type ReadOnlyKind = "notices" | "merges";
/** A core list, or a stored module's state under the module's id. */
export type ListKind = keyof ListChanges | ReadOnlyKind | StoredModuleId;
export type ListMessage<T extends ListKind = ListKind> = T extends StoredModuleId ? ModuleMsg<T> : Extract<ServerMsg, { t: T }>;
type EditableEntries = {
	[T in keyof ListChanges]: { msg(): ListMessage<T>; apply(change: ListChanges[T]): boolean };
};
type ListEntries = EditableEntries & { [T in ReadOnlyKind]: { msg(): ListMessage<T> } };
export class ListRegistry {
	readonly #entries: ListEntries;
	readonly #modules: ModuleFiles;
	readonly #push: (kind: ListKind) => void;

	constructor(entries: ListEntries, modules: ModuleFiles, push: (kind: ListKind) => void) {
		this.#entries = entries;
		this.#modules = modules;
		this.#push = push;
	}

	message(kind: ListKind): ListMessage {
		return this.#isModule(kind) ? this.#moduleMessage(kind) : this.#entries[kind].msg();
	}

	/** Current whole lists, including ones that have never changed or been published. */
	*messages(): Iterable<ListMessage> {
		for (const entry of Object.values(this.#entries)) yield entry.msg();
		for (const id of Object.keys(this.#modules)) if (this.#isModule(id)) yield this.#moduleMessage(id);
	}

	/** Publish a changed list; a no-op instead resends the current list to the requesting page alone, and so does a refused change before it throws, so the page drops what it already shows. */
	apply<T extends keyof ListChanges>(kind: T, change: ListChanges[T], peer?: Pick<Peer, "send">): boolean {
		const entries: EditableEntries = this.#entries;
		return this.#publish(kind, () => entries[kind].apply(change), peer);
	}

	/** {@link apply} for stored module `id`'s state. */
	applyModule<I extends StoredModuleId>(id: I, change: ModuleChanges[I], peer?: Pick<Peer, "send">): boolean {
		return this.#publish(id, () => this.#modules[id].apply(change), peer);
	}

	#publish(kind: ListKind, apply: () => boolean, peer: Pick<Peer, "send"> | undefined): boolean {
		let changed: boolean;
		try {
			changed = apply();
		} catch (error) {
			peer?.send(this.message(kind));
			throw error;
		}
		if (changed) this.#push(kind);
		else peer?.send(this.message(kind));
		return changed;
	}

	#isModule(kind: string): kind is StoredModuleId {
		return Object.hasOwn(this.#modules, kind);
	}

	#moduleMessage<I extends StoredModuleId>(id: I): ModuleMsg<I> {
		return { t: "module", id, value: this.#modules[id].value };
	}
}
