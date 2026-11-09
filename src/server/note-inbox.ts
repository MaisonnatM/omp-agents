/**
 * The changes omp's `user_note` tool leaves for the Notes page's list, one JSON file each in a directory, so the server
 * stays the only writer of `notes.json` and a session can note something while the dashboard is down. An agent may add
 * a note in its own name or append to one; the inbox sets aside any other change, so it cannot rewrite or remove what
 * you wrote. An added note goes into the space of the session that added it, whatever space the file names.
 */
import { errorText } from "../json";
import type { Space } from "../shared/workspaces";
import { parseNoteChange } from "../user-notes-parse";
import type { UserNoteChange } from "../user-notes-shared";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

/** The space of omp session `sessionId`'s directory, Work for a session the dashboard does not know. */
export type SpaceOfSession = (sessionId: string) => Promise<Space>;

/** `value` as a change an agent may make, or why not. */
function parseAgentNoteChange(value: unknown): InboxEntry<UserNoteChange> {
	let change: UserNoteChange | null;
	try {
		change = parseNoteChange(value);
	} catch (err) {
		return { invalid: errorText(err) };
	}
	if (!change) return { invalid: "it is not a change to the note list" };
	if (change.op === "append") return { item: change };
	if (change.op !== "add") return { invalid: `an agent may only add or append to a note, not ${change.op}` };
	return change.note.addedBy === null ? { invalid: "an agent's note must name the session that added it" } : { item: change };
}

export class NoteInbox extends JsonInboxDir<UserNoteChange> {
	constructor(dir: string, apply: (change: UserNoteChange) => void, spaceOf: SpaceOfSession, options?: InboxOptions) {
		super(
			dir,
			{
				parse: (_name, value) => parseAgentNoteChange(value),
				async apply(change) {
					apply(change.op === "add" && change.note.addedBy !== null ? { ...change, note: { ...change.note, space: await spaceOf(change.note.addedBy) } } : change);
					return true;
				},
			},
			options,
		);
	}
}
