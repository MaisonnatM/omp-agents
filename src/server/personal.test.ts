import { expect, test } from "bun:test";
import { dirname, join, relative } from "node:path";
import { HOME, personalDir } from "../paths";
import { isPersonalDir } from "./personal";

test("a session in the personal directory, so one that stays put without move_session, is named so however omp or the page names the directory, and nowhere else", () => {
	expect(isPersonalDir(personalDir)).toBe(true);
	expect(isPersonalDir(`${personalDir}/`)).toBe(true);
	expect(isPersonalDir(` ${personalDir}\n`)).toBe(true);
	expect(isPersonalDir(join("~", relative(HOME, personalDir)))).toBe(true);
	expect(isPersonalDir(join(personalDir, "recipes"))).toBe(false);
	expect(isPersonalDir(dirname(personalDir))).toBe(false);
	expect(isPersonalDir(`${personalDir}-old`)).toBe(false);
	expect(isPersonalDir(undefined)).toBe(false);
});
