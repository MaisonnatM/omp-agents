/**
 * The changes omp's `user_todo` tool leaves for the Todo page's list, one JSON file each in a directory, so the server
 * stays the only writer of `todos.json` and a session can file a todo while the dashboard is down. An agent may add a
 * todo, check one, which marks it Done, edit one's title, notes, due day, or section, or delete one; the inbox sets aside
 * any other change, such as unchecking, another status, a move, or a change to the sections.
 */
import { errorText } from "../json";
import { parseAgentChange } from "../user-todos-parse";
import type { UserTodoChange } from "../user-todos-shared";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

/** The changes an agent may make; each other one leaves the list as you set it. */
const AGENT_OPS: Partial<Record<UserTodoChange["op"], true>> = { add: true, edit: true, "edit-body": true, "set-due": true, categorize: true, remove: true };

/** `value` as a change an agent may make, or why not. */
function parseTodoChange(value: unknown): InboxEntry<UserTodoChange> {
	let change: UserTodoChange | null;
	try {
		change = parseAgentChange(value, new Date().toISOString());
	} catch (err) {
		return { invalid: errorText(err) };
	}
	if (!change) return { invalid: "it is not a change to the todo list" };
	if (AGENT_OPS[change.op] || (change.op === "set-status" && change.status === "done")) return { item: change };
	return {
		invalid: `an agent may only add, check, edit, or delete a todo, not ${change.op === "set-status" ? `mark one ${change.status}` : change.op}`,
	};
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
