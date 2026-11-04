/**
 * The requests a Bot's tools (`src/omp/bot-extension.ts`, `src/omp/designer-extension.ts`) leave for the Bots, one JSON
 * file each in a directory, so the server stays the only writer of `bots.json` and a Bot can ask while the dashboard is
 * down: a `set_job` saves its Bot as the page would with only the job changed, a designer's `create_bot` saves a new
 * Bot as the New Bot form would, so every page hears it, and a `message_bot` sends its text, stamped with the sender,
 * into the other Bot's conversation.
 */
import { errorText } from "../json";
import { botMessageText } from "../shared/bot-message";
import { type Bot, type BotChange, type BotId, defaultLook, MAX_BOT_MESSAGES_PER_HOUR, parseBotInboxRequest } from "../shared/bots";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

type BotSave = Extract<BotChange, { op: "save" }>;
/** A message Bot `from` sends Bot `to`. */
type BotDelivery = { op: "deliver"; from: Bot; to: Bot; text: string };

const HOUR = 60 * 60 * 1000;

export interface BotInboxDeps {
	bots(): readonly Bot[];
	/** Whether the Bots changed; a save they refuse moves its file aside with the reason. */
	save(change: BotSave): boolean;
	/** Sends `text` into Bot `to`'s conversation. */
	deliver(to: BotId, text: string): Promise<unknown>;
	/** In ms since the epoch. */
	now(): number;
}

/** `value` as what it asks of `bots`: a save, a delivery, or `null` when they already hold it; or why it is no request. */
function parseRequest(value: unknown, bots: readonly Bot[]): InboxEntry<BotSave | BotDelivery | null> {
	const request = parseBotInboxRequest(value);
	if (!request) return { invalid: "it is not a request for the Bots" };
	const asker = bots.find(({ id }) => id === request.ok.botId);
	if (!asker) return { invalid: `there is no Bot ${request.ok.botId}; it may have been deleted since` };
	switch (request.ok.op) {
		case "job": {
			const { job } = request.ok;
			if (asker.job === job) return { item: null };
			const { id, kind, name, cwd, model, skill, shape, hue } = asker;
			return { item: { op: "save", bot: { id, kind, name, job, cwd, model, skill, shape, hue } } };
		}
		case "create": {
			if (asker.kind !== "bot-designer") return { invalid: `Bot ${asker.id} is not a Bot designer, so the create was misrouted` };
			const { create } = request.ok;
			// The id is the tool's, so a Bot that has it is this request applied already, never another Bot to edit.
			if (bots.some(({ id }) => id === create.id)) return { item: null };
			return { item: { op: "save", bot: { ...create, model: null, skill: null, ...defaultLook(create.id) } } };
		}
		case "message": {
			const { to, text } = request.ok.message;
			if (to === asker.id) return { invalid: `Bot ${asker.id} messaged itself` };
			const recipient = bots.find(({ id }) => id === to);
			if (!recipient) return { invalid: `there is no Bot ${to} to message; it may have been deleted since` };
			return { item: { op: "deliver", from: asker, to: recipient, text } };
		}
		default: {
			const unhandled: never = request.ok;
			return unhandled;
		}
	}
}

export class BotInbox extends JsonInboxDir<BotSave | BotDelivery | null> {
	constructor(dir: string, deps: BotInboxDeps, options?: InboxOptions) {
		/**
		 * The deliveries of the last hour from one Bot to another, by `<from> <to>`, and whether the sender heard it reached
		 * the limit since its last delivery: two Bots that answer each other stop at the limit, and a sender told once is not
		 * woken again by each message it sends past it.
		 */
		const pairs = new Map<string, { sent: number[]; told: boolean }>();
		const deliver = async ({ from, to, text }: BotDelivery): Promise<true> => {
			const refuse = (why: string) => deps.deliver(from.id, `The dashboard did not deliver your message to ${to.name}: ${why}.`);
			const now = deps.now();
			const key = `${from.id} ${to.id}`;
			const pair = pairs.get(key) ?? { sent: [], told: false };
			pair.sent = pair.sent.filter(at => at > now - HOUR);
			pairs.set(key, pair);
			if (pair.sent.length >= MAX_BOT_MESSAGES_PER_HOUR) {
				if (!pair.told) await refuse(`you sent it ${MAX_BOT_MESSAGES_PER_HOUR} messages in the last hour; the dashboard drops the next ones without telling you until the hour has passed`);
				pair.told = true;
				return true;
			}
			try {
				await deps.deliver(to.id, botMessageText({ from: from.id, name: from.name, text }));
			} catch (error) {
				await refuse(errorText(error));
				return true;
			}
			pair.sent.push(now);
			pair.told = false;
			return true;
		};
		super(
			dir,
			{
				parse: (_name, value) => parseRequest(value, deps.bots()),
				apply(item) {
					if (item?.op === "deliver") return deliver(item);
					if (item === null || deps.save(item)) return true;
					throw new Error("the Bots refused it");
				},
			},
			options,
		);
	}
}
