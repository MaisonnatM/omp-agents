/**
 * The Board composer's chips and its `@` and `/` lists, read with the grammar `src/shared/board.ts` wakes members and
 * runs commands by, so what shows as a chip is what wakes or runs.
 */
import { IconRunShortcut, IconUser } from "central-icons";
import { BOARD_COMMANDS, type Member, mentionPattern } from "../src/shared/board";
import type { MenuOption } from "./mentions";
import { type Pattern, type Tokenize, tokenizer } from "./prompt-tokens";

const COMMAND: Pattern = {
	re: new RegExp(`^/(${BOARD_COMMANDS.map(command => command.name).join("|")})(?=\\s|$)`, "g"),
	leading: true,
	token: m => ({ kind: "command", label: m[1], target: m[1] }),
};

/** A Board message's chips: a member's mention, and a command where the message starts. */
export function boardTokens(members: readonly Member[]): Tokenize {
	const mention = mentionPattern(members);
	if (!mention) return tokenizer([COMMAND]);
	const ids = new Map(members.map(member => [member.name.toLowerCase(), member.id]));
	return tokenizer([COMMAND, { re: mention, token: m => ({ kind: "person", label: `@${m[1]}`, target: ids.get(m[1].toLowerCase()) ?? m[1] }) }]);
}

/** The `@` or `/` the caret is typing: what it replaces, from `start` to `end`, and the query after it. */
export interface BoardTrigger {
	kind: "@" | "/";
	start: number;
	end: number;
	query: string;
}

/** The trigger the caret at `cursor` is typing: an `@` after the start or a space, or a `/` that starts the message. */
export function boardTrigger(text: string, cursor: number): BoardTrigger | null {
	const before = text.slice(0, cursor);
	const command = before.match(/^\s*\/([a-z]*)$/);
	if (command) return { kind: "/", start: cursor - command[1].length - 1, end: cursor, query: command[1] };
	const mention = before.match(/(?:^|\s)@([^@\n]{0,40})$/u);
	return mention ? { kind: "@", start: cursor - mention[1].length - 1, end: cursor, query: mention[1] } : null;
}

/** The options `trigger` offers in `text`: the members whose name starts with its query, or the commands. */
export function boardMenu(text: string, trigger: BoardTrigger, members: readonly Member[]): MenuOption[] {
	const option = (icon: MenuOption["icon"], label: string, detail: string | null, inserted: string): MenuOption => {
		const head = text.slice(0, trigger.start) + inserted;
		const tail = text.slice(trigger.end);
		return { icon, label, detail, edit: { text: `${head}${tail.startsWith(" ") ? "" : " "}${tail}`, cursor: head.length + 1 }, opens: false };
	};
	if (trigger.kind === "/") return BOARD_COMMANDS.filter(command => command.name.startsWith(trigger.query)).map(command => option(IconRunShortcut, `/${command.name}`, command.about, `/${command.name}`));
	const query = trigger.query.toLowerCase();
	return members
		.filter(member => member.name.toLowerCase().startsWith(query))
		.slice(0, 6)
		.map(member => option(IconUser, member.name, member.presence === "asleep" ? "queues until it wakes" : member.kind === "human" ? "person" : (member.harness ?? null), `@${member.name}`));
}
