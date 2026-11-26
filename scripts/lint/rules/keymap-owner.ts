import { lineAt, type Rule } from "../rule";

const GLOBAL_KEY_LISTENER = /\b(window|document)\.addEventListener\(\s*["'`]key(down|up|press)["'`]/g;

/** A key listener on the whole page is a shortcut: it belongs in `web/shortcuts.ts`, whose `ShortcutId` table the help, the settings, and the docs read, so two parts of the page never claim the same key unseen. */
export const keymapOwner: Rule = {
	id: "keymap-owner",
	why: "Register a page-wide key in web/shortcuts.ts, never with window or document addEventListener, so every shortcut is in one table.",
	appliesTo: path => /^web\/.*\.tsx?$/.test(path) && path !== "web/shortcuts.ts" && !/\.test\.tsx?$/.test(path),
	check(source) {
		return [...source.matchAll(GLOBAL_KEY_LISTENER)].map(match => ({
			line: lineAt(source, match.index),
			message: `${match[1]}.addEventListener("key${match[2]}") listens to the whole page outside web/shortcuts.ts`,
		}));
	},
};
