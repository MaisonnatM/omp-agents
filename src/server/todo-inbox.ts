/**
 * The changes omp's `user_todo` tool leaves for the Todo page's list, one JSON file each in a directory, so the server
 * stays the only writer of `todos.json` and a session can file a todo while the dashboard is down. An agent may add a
 * todo or check one, which marks it Done; the inbox sets aside any other change, unchecking included, so it cannot undo
 * what you did.
 */
import { errorText } from "../json";
import { parseAgentChange } from "../user-todos-parse";
import type { UserTodoChange } from "../user-todos-shared";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

/** `value` as a change an agent may make, or why not. */
function parseTodoChange(value: unknown): InboxEntry<UserTodoChange> {
	let change: UserTodoChange | null;
	try {
		change = parseAgentChange(value, new Date().toISOString());
	} catch (err) {
		return { invalid: errorText(err) };
	}
	if (!change) return { invalid: "it is not a change to the todo list" };
	if (change.op === "add" || (change.op === "set-status" && change.status === "done")) return { item: change };
	return { invalid: `an agent may only add or check a todo, not ${change.op === "set-status" ? `mark one ${change.status}` : change.op}` };
}

export class TodoInbox extends JsonInboxDir<UserTodoChange> {
	constructor(dir: string, apply: (change: UserTodoChange) => void, options?: InboxOptions) {
		super(
			dir,
			{
				parse: (_name, value) => parseTodoChange(value),
				apply(change) {
					apply(change);
					return true;
				},
			},
			options,
		);
	}
}
