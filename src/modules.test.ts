import { expect, test } from "bun:test";
import { moduleJoins, SERVER_MODULES } from "./modules";
import { MODULES_OFF_KEY, parseModulesOff } from "./shared/modules-off";

const known = (id: string): id is "sport" | "email" => id === "sport" || id === "email";

test("the modules-off preference keeps the known ids once, and reads anything unreadable as none off", () => {
	expect(parseModulesOff(JSON.stringify(["sport", "bogus", 3, "sport", "email"]), known)).toEqual(["sport", "email"]);
	for (const raw of [null, undefined, "", "not json", "{\"sport\":true}", "\"sport\""]) expect(parseModulesOff(raw, known)).toEqual([]);
});

const sport = SERVER_MODULES.sport.join!;

test("a new session joins with every module's join, less those the preferences turn off", () => {
	expect(moduleJoins(null)).toEqual([sport]);
	expect(moduleJoins({ [MODULES_OFF_KEY]: JSON.stringify(["email", "bogus"]) })).toEqual([sport]);
	expect(moduleJoins({ [MODULES_OFF_KEY]: JSON.stringify(["sport"]) })).toEqual([]);
});
