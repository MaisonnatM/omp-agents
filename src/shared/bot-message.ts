/**
 * What one Bot's `message_bot` sends into another Bot's conversation: the text, then one stamp line that carries the
 * sender as JSON, so every reader of the conversation tells the message from one the user wrote, as a routine's stamp does.
 */
import { isNonEmpty, isObject, parseJson } from "../json";
import { type BotId, parseBotId } from "./bots";

/** A Bot message: the Bot that sent it, its name as of the send, and the text. */
export interface BotMessage {
	from: BotId;
	name: string;
	text: string;
}

/** What starts a Bot message's last line, before the sender as JSON. */
export const BOT_MESSAGE_STAMP = "# omp-agents Bot message, sent by another Bot, not the user: ";

/** The prompt that carries `message`. */
export function botMessageText({ from, name, text }: BotMessage): string {
	return `${text}\n\n${BOT_MESSAGE_STAMP}${JSON.stringify({ from, name })}`;
}

/** The message stamped `text` carries, or `null` for any text the format did not write; the last valid stamp wins, as a routine's. */
export function readBotMessage(text: string): BotMessage | null {
	const trimmed = text.trimEnd();
	for (let at = trimmed.lastIndexOf(BOT_MESSAGE_STAMP); at >= 0; at = at === 0 ? -1 : trimmed.lastIndexOf(BOT_MESSAGE_STAMP, at - 1)) {
		if (at > 0 && !/\s/.test(trimmed[at - 1]!)) continue;
		const stamp = parseJson(trimmed.slice(at + BOT_MESSAGE_STAMP.length));
		if (!isObject(stamp)) continue;
		const from = parseBotId(stamp.from);
		if (!from || !isNonEmpty(stamp.name)) continue;
		const before = trimmed.slice(0, at);
		return { from, name: stamp.name, text: before.endsWith("\n\n") ? before.slice(0, -2) : before.trimEnd() };
	}
	return null;
}
