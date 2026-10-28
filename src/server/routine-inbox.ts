/**
 * The changes a Bot's `save_routine` and `delete_routine` tools (`src/omp/bot-extension.ts`) leave for the routines, one
 * JSON file each in a directory, so the server stays the only writer of `routines.json` and a Bot can change its
 * routines while the dashboard is down. A Bot may save or delete only its own routines, which the inbox checks against
 * the routines as each file applies, so a request a Bot's tool let through still cannot touch another Bot's routine.
 */
import { type BotRoutineChange, isSameSpec, parseBotRoutineRequest, type Routine } from "../routines";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

/** `value` as a change its Bot may make to `routines`, or why not. */
function parseOwnChange(value: unknown, routines: readonly Routine[]): InboxEntry<BotRoutineChange> {
	const request = parseBotRoutineRequest(value);
	if (!request) return { invalid: "it is not a change to one of a Bot's routines" };
	const { botId, change } = request.ok;
	if (change.op === "save" && change.routine.botId !== botId) return { invalid: `Bot ${botId} may not save a routine of Bot ${change.routine.botId}` };
	const id = change.op === "save" ? change.routine.id : change.id;
	const owner = routines.find(routine => routine.id === id)?.botId;
	if (owner === undefined) return change.op === "save" ? { item: change } : { invalid: `there is no routine ${id} to delete` };
	return owner === botId ? { item: change } : { invalid: `routine ${id} belongs to Bot ${owner}, not ${botId}` };
}

export class RoutineInbox extends JsonInboxDir<BotRoutineChange> {
	/** `apply` returns whether the routines changed, and a change they refuse, such as a save for a Bot deleted since, moves its file aside with the reason. */
	constructor(dir: string, routines: () => readonly Routine[], apply: (change: BotRoutineChange) => boolean, options?: InboxOptions) {
		super(
			dir,
			{
				parse: (_name, value) => parseOwnChange(value, routines()),
				apply(change) {
					// `apply` is false for a save the routines already hold too, as when the Bot saved the same edit twice while the dashboard was stopped, and that one is done.
					const held = change.op === "save" && routines().some(routine => routine.id === change.routine.id && isSameSpec(routine, change.routine));
					if (held || apply(change)) return true;
					throw new Error("the routines refused it; its Bot may be gone");
				},
			},
			options,
		);
	}
}
