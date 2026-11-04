/**
 * What one Bot's `message_bot` sends into another Bot's conversation: the text, then one stamp line that carries the
 * sender as JSON, so every reader of the conversation tells the message from one the user wrote, as a routine's stamp does.
 */
import { isNonEmpty, isObject } from "../json";
import { type BotId, parseBotId } from "./bots";
import { readStamped, stampedText } from "./stamp";

/** A Bot message: the Bot that sent it, its name as of the send, and the text. */
export interface BotMessage {
	from: BotId;
	name: string;
	text: string;
}

/** What starts a Bot message's last line, before the sender as JSON. */
export const BOT_MESSAGE_STAMP = "# omp-agents Bot message, sent by another Bot, not the user: ";

/** The prompt that carries `message`. */
export const botMessageText = ({ from, name, text }: BotMessage): string => stampedText(text, BOT_MESSAGE_STAMP, { from, name });

/** The message stamped `text` carries, or `null` for any text the format did not write; the last valid stamp wins, as a routine's. */
export const readBotMessage = (text: string): BotMessage | null =>
	readStamped(text, BOT_MESSAGE_STAMP, (body, stamp) => {
		if (!isObject(stamp) || !isNonEmpty(stamp.name)) return null;
		const from = parseBotId(stamp.from);
		return from ? { from, name: stamp.name, text: body } : null;
	});
