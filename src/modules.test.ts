import { expect, test } from "bun:test";
import { moduleJoins, SERVER_MODULES } from "./modules";
import { MODULES_OFF_KEY, parseModulesOff } from "./shared/modules-off";

const known = (id: string): id is "sport" | "weather" => id === "sport" || id === "weather";

test("the modules-off preference keeps the known ids once, and reads anything unreadable as none off", () => {
	expect(parseModulesOff(JSON.stringify(["sport", "bogus", 3, "sport", "weather"]), known)).toEqual(["sport", "weather"]);
	for (const raw of [null, undefined, "", "not json", "{\"sport\":true}", "\"sport\""]) expect(parseModulesOff(raw, known)).toEqual([]);
});

const sport = SERVER_MODULES.sport.join!;
const memory = SERVER_MODULES.memory.join!;
const board = SERVER_MODULES.board.join!;

test("a new session joins with every module's join, less those the preferences turn off", () => {
	expect(moduleJoins(null)).toEqual([sport, memory, board]);
	expect(moduleJoins({ [MODULES_OFF_KEY]: JSON.stringify(["weather", "bogus"]) })).toEqual([sport, memory, board]);
	expect(moduleJoins({ [MODULES_OFF_KEY]: JSON.stringify(["sport"]) })).toEqual([memory, board]);
	expect(moduleJoins({ [MODULES_OFF_KEY]: JSON.stringify(["sport", "memory", "board"]) })).toEqual([]);
});
