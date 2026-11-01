/**
 * The requests a Bot's tools (`src/omp/bot-extension.ts`, `src/omp/designer-extension.ts`) leave for the Bots, one JSON
 * file each in a directory, so the server stays the only writer of `bots.json` and a Bot can ask while the dashboard is
 * down: a `set_job` saves its Bot as the page would with only the job changed, and a designer's `create_bot` saves a new
 * Bot as the New Bot form would, so every page hears it.
 */
import { type Bot, type BotChange, defaultLook, parseBotInboxRequest } from "../shared/bots";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

type BotSave = Extract<BotChange, { op: "save" }>;

/** `value` as the save it asks of `bots`, `null` when they already hold it, or why it is no request. */
function parseRequest(value: unknown, bots: readonly Bot[]): InboxEntry<BotSave | null> {
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
		default: {
			const unhandled: never = request.ok;
			return unhandled;
		}
	}
}

export class BotInbox extends JsonInboxDir<BotSave | null> {
	/** `apply` returns whether the Bots changed, and a save they refuse moves its file aside with the reason. */
	constructor(dir: string, bots: () => readonly Bot[], apply: (change: BotSave) => boolean, options?: InboxOptions) {
		super(
			dir,
			{
				parse: (_name, value) => parseRequest(value, bots()),
				apply(change) {
					if (change === null || apply(change)) return true;
					throw new Error("the Bots refused it");
				},
			},
			options,
		);
	}
}
