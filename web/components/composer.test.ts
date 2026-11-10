import { expect, test } from "bun:test";
import { blockedShortcut } from "./composer";

test("a shortcut behind leading blanks is held back like the trimmed text Enter would send", () => {
	for (const draft of [" $ npm i", "\n!!ls", "\t$x"]) {
		expect(blockedShortcut(draft, "rpc")).toBe(blockedShortcut(draft.trim(), "rpc"));
		expect(blockedShortcut(draft, "rpc")).not.toBeNull();
	}
	expect(blockedShortcut(" !ls", "new")).toBe(blockedShortcut("!ls", "new"));
	expect(blockedShortcut(" !ls", "none")).not.toBeNull();
	expect(blockedShortcut(" !ls", "rpc")).toBeNull();
	expect(blockedShortcut("say $x or !y", "none")).toBeNull();
});
