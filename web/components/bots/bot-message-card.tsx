/** `BotMessageCard`, a message another Bot sent into a Bot's conversation: the sender's face and name, a link to its page, over what it wrote. */
import { createContext, useContext } from "react";
import type { BotMessage } from "../../../src/shared/bot-message";
import { type Bot, defaultLook } from "../../../src/shared/bots";
import { hashForBots } from "../../routing";
import { BOT_MESSAGE_PRESET, MessageMarkdown } from "../message-markdown";
import { BotAvatar } from "./bot-avatar";

/** The Bots a page around a conversation knows, so a message from one shows its face; none outside a Bot's page. */
export const KnownBots = createContext<readonly Bot[]>([]);

export function BotMessageCard({ message }: { message: BotMessage }) {
	// A Bot deleted since it sent the message keeps the name it signed with, and the face its id gave it at first.
	const sender = useContext(KnownBots).find(bot => bot.id === message.from);
	const from = (
		<>
			<BotAvatar look={sender ?? defaultLook(message.from)} size="header" />
			<span className="min-w-0 truncate">From {sender?.name ?? message.name}</span>
		</>
	);
	return (
		<div className="w-full overflow-hidden rounded-lg border border-border bg-card text-sm" data-item="bot-message">
			{sender ? (
				<a href={hashForBots(sender.id)} className="flex min-h-9 min-w-0 items-center gap-2 px-3 py-1.5 font-medium hover:underline">
					{from}
				</a>
			) : (
				<p className="flex min-h-9 min-w-0 items-center gap-2 px-3 py-1.5 font-medium">{from}</p>
			)}
			<div className="px-3 pb-2.5">
				<MessageMarkdown text={message.text} preset={BOT_MESSAGE_PRESET} />
			</div>
		</div>
	);
}
