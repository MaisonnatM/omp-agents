/**
 * The jobs a Bot's `set_job` tool (`src/omp/bot-extension.ts`) leaves for the Bots, one JSON file each in a directory, so
 * the server stays the only writer of `bots.json` and a Bot can set its job while the dashboard is down. Each one saves
 * its Bot as the page would, with only the job changed, so every page hears it.
 */
import { type Bot, type BotChange, parseBotJobRequest } from "../shared/bots";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

type BotSave = Extract<BotChange, { op: "save" }>;

/** `value` as a save of its Bot in `bots` with only the job changed, or why not. */
function parseJobSave(value: unknown, bots: readonly Bot[]): InboxEntry<BotSave> {
	const request = parseBotJobRequest(value);
	if (!request) return { invalid: "it is not a job for a Bot" };
	const { botId, job } = request.ok;
	const bot = bots.find(({ id }) => id === botId);
	if (!bot) return { invalid: `there is no Bot ${botId}; it may have been deleted since` };
	const { id, name, cwd, model, skill, shape, hue } = bot;
	return { item: { op: "save", bot: { id, name, job, cwd, model, skill, shape, hue } } };
}

export class BotInbox extends JsonInboxDir<BotSave> {
	/** `apply` returns whether the Bots changed, and a save they refuse moves its file aside with the reason. */
	constructor(dir: string, bots: () => readonly Bot[], apply: (change: BotSave) => boolean, options?: InboxOptions) {
		super(
			dir,
			{
				parse: (_name, value) => parseJobSave(value, bots()),
				apply(change) {
					// `apply` is false for a job the Bot already holds too, as when it set the same job twice while the dashboard was stopped, and that one is done.
					if (bots().find(bot => bot.id === change.bot.id)?.job === change.bot.job || apply(change)) return true;
					throw new Error("the Bots refused it");
				},
			},
			options,
		);
	}
}
