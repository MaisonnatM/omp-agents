/** The Bots, kept in `bots.json`, which a Bot's session reads its name and job from on every turn. */
import { ReducerFile } from "../fs";
import { applyBot, type Bot, type BotEdit, parseBots } from "../shared/bots";

export class BotsFile extends ReducerFile<Bot[], [edit: BotEdit, now: string]> {
	constructor(path: string) {
		super(path, { parse: parseBots, toJson: bots => ({ bots }), holds: "a list of Bots", empty: [], reduce: applyBot });
	}
}
