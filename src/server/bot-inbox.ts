/**
 * The requests a Bot's tools (`src/omp/bot-extension.ts`, `src/omp/designer-extension.ts`) leave for the Bots, one JSON
 * file each in a directory, so the server stays the only writer of `bots.json` and a Bot can ask while the dashboard is
 * down: a `set_job` saves its Bot as the page would with only the job changed, a designer's `create_bot` saves a new
 * Bot as the New Bot form would, so every page hears it, and a `message_bot` sends its text, stamped with the sender,
 * into the other Bot's conversation.
 */
import { errorText } from "../json";
import { botMessageText } from "../shared/bot-message";
import { type Bot, BOT_MESSAGE_WINDOW_MS, type BotChange, type BotId, defaultLook, MAX_BOT_MESSAGES_PER_HOUR, parseBotInboxRequest } from "../shared/bots";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

type BotSave = Extract<BotChange, { op: "save" }>;
/** A message Bot `from` sends Bot `to`. */
type BotDelivery = { op: "deliver"; from: Bot; to: Bot; text: string };

export interface BotInboxDeps {
	bots(): readonly Bot[];
	/** Whether the Bots changed; a save they refuse moves its file aside with the reason. */
	save(change: BotSave): boolean;
	/** Sends `text` into Bot `to`'s conversation. */
	tell(to: BotId, text: string): Promise<unknown>;
	/** In ms since the epoch. */
	now(): number;
}

/**
 * The deliveries of the last {@link BOT_MESSAGE_WINDOW_MS} from one Bot to another, and whether the sender heard it reached
 * the limit since its last delivery: two Bots that answer each other stop at the limit, and a sender told once is not
 * woken again by each message it sends past it.
 */
export class PairLimit {
	#pairs = new Map<string, { sent: number[]; told: boolean }>();

	/** Whether a message from `from` to `to` at `now` goes through, or is dropped after telling its sender, the first time past the limit, or not. */
	check(from: BotId, to: BotId, now: number): "deliver" | "tell" | "drop" {
		const pair = this.#pair(from, to, now);
		if (pair.sent.length < MAX_BOT_MESSAGES_PER_HOUR) return "deliver";
		if (pair.told) return "drop";
		pair.told = true;
		return "tell";
	}

	delivered(from: BotId, to: BotId, now: number): void {
		const pair = this.#pair(from, to, now);
		pair.sent.push(now);
		pair.told = false;
	}

	#pair(from: BotId, to: BotId, now: number): { sent: number[]; told: boolean } {
		const key = `${from} ${to}`;
		const pair = this.#pairs.get(key) ?? { sent: [], told: false };
		pair.sent = pair.sent.filter(at => at > now - BOT_MESSAGE_WINDOW_MS);
		this.#pairs.set(key, pair);
		return pair;
	}
}

/** Sends `text` from `from` into `to`'s conversation within `limit`, telling `from` when the dashboard did not. */
async function deliverMessage(deps: BotInboxDeps, limit: PairLimit, { from, to, text }: BotDelivery): Promise<true> {
	const refuse = (why: string) => deps.tell(from.id, `The dashboard did not deliver your message to ${to.name}: ${why}.`);
	const now = deps.now();
	const verdict = limit.check(from.id, to.id, now);
	if (verdict === "tell") await refuse(`you sent it ${MAX_BOT_MESSAGES_PER_HOUR} messages in the last hour; the dashboard drops the next ones without telling you until the hour has passed`);
	if (verdict !== "deliver") return true;
	try {
		await deps.tell(to.id, botMessageText({ from: from.id, name: from.name, text }));
	} catch (error) {
		await refuse(errorText(error));
		return true;
	}
	limit.delivered(from.id, to.id, now);
	return true;
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
		const limit = new PairLimit();
		super(
			dir,
			{
				parse: (_name, value) => parseRequest(value, deps.bots()),
				apply(item) {
					if (item?.op === "deliver") return deliverMessage(deps, limit, item);
					if (item === null || deps.save(item)) return true;
					throw new Error("the Bots refused it");
				},
			},
			options,
		);
	}
}
