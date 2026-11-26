import { describe, expect, test } from "bun:test";
import { IconFolder1 } from "central-icons";
import {
	chordAction,
	type Frecency,
	type HomeSection,
	type PaletteAction,
	paletteCommands,
	type PaletteEvent,
	type PaletteItem,
	paletteReducer,
	paletteSections,
	type PaletteState,
	type Section,
} from "./command-palette";
import type { ShortcutHandlers } from "./shortcuts";

const noop = (): void => {};
const DAY = 86_400_000;
const NOW = 1_000 * DAY;

const action = (id: string, chord?: PaletteAction["chord"]): PaletteAction => ({ id, title: id, icon: IconFolder1, chord, run: { kind: "do", fn: noop } });
const item = (id: string, section: HomeSection, title: string): PaletteItem => ({
	id,
	section,
	title,
	keywords: [],
	icon: IconFolder1,
	accessories: [],
	kind: "Test",
	actions: [[action("run")]],
});
const listed = (sections: readonly Section[]) => sections.map(({ id, items }) => [id, items.map(entry => entry.id)]);

const apply = (state: PaletteState | null, ...events: PaletteEvent[]): PaletteState | null => events.reduce(paletteReducer, state);
const views = (state: PaletteState | null) => state?.stack.map(frame => frame.view) ?? null;
const query = (state: PaletteState | null) => state?.stack[state.stack.length - 1]?.query ?? null;

describe("paletteReducer", () => {
	test("Esc closes the action panel, then goes back, then clears the search, then closes", () => {
		let state = apply(
			null,
			{ type: "open" },
			{ type: "query", query: "dep" },
			{ type: "push", view: "workspaces" },
			{ type: "query", query: "web" },
			{ type: "select", itemId: "workspace:/w" },
			{ type: "togglePanel" },
		);
		expect(state?.panel).toEqual({ itemId: "workspace:/w", query: "" });
		state = apply(state, { type: "escape" });
		expect([views(state), query(state), state?.panel]).toEqual([["root", "workspaces"], "web", null]);
		state = apply(state, { type: "escape" });
		expect([views(state), query(state)]).toEqual([["root"], "dep"]);
		state = apply(state, { type: "escape" });
		expect([views(state), query(state)]).toEqual([["root"], ""]);
		expect(apply(state, { type: "escape" })).toBeNull();
	});

	test("Backspace in an empty field goes back from a pushed view and does nothing at the root", () => {
		const root = apply(null, { type: "open" });
		expect(apply(root, { type: "backspaceOnEmpty" })).toBe(root);
		const typed = apply(root, { type: "push", view: "workspaces" }, { type: "query", query: "w" });
		expect(views(apply(typed, { type: "backspaceOnEmpty" }))).toEqual(["root", "workspaces"]);
		expect(views(apply(typed, { type: "query", query: "" }, { type: "backspaceOnEmpty" }))).toEqual(["root"]);
	});

	test("the action panel opens only on a highlighted item", () => {
		expect(apply(null, { type: "open" }, { type: "togglePanel" })?.panel).toBeNull();
	});
});

describe("paletteSections", () => {
	test("of two equal matches, the one used more lately ranks first, and an old use fades", () => {
		const items = [item("session:a", "running", "Deploy web"), item("session:b", "running", "Deploy web")];
		expect(listed(paletteSections(items, "deploy", {}, NOW))).toEqual([["running", ["session:a", "session:b"]]]);
		expect(listed(paletteSections(items, "deploy", { "session:b": { count: 1, last: NOW } }, NOW))).toEqual([["running", ["session:b", "session:a"]]]);
		const frecency: Frecency = { "session:a": { count: 3, last: NOW - 28 * DAY }, "session:b": { count: 1, last: NOW } };
		expect(listed(paletteSections(items, "deploy", frecency, NOW))).toEqual([["running", ["session:b", "session:a"]]]);
	});

	test("sections rank by their best match", () => {
		const items = [item("session:p", "past", "Deploy fix"), item("session:r", "running", "Notes"), item("command:deploy", "commands", "Deploy")];
		expect(listed(paletteSections(items, "deploy", {}, NOW))).toEqual([
			["commands", ["command:deploy"]],
			["past", ["session:p"]],
		]);
	});

	test("an empty search leads with the five most used items, which leave their own sections", () => {
		const items = [
			item("session:r1", "running", "r1"),
			item("session:r2", "running", "r2"),
			item("command:c1", "commands", "c1"),
			item("command:c2", "commands", "c2"),
			item("command:c3", "commands", "c3"),
			item("session:p1", "past", "p1"),
			item("session:p2", "past", "p2"),
		];
		const used = (count: number) => ({ count, last: NOW });
		const frecency: Frecency = {
			"session:r1": used(6),
			"session:p1": used(5),
			"command:c1": used(4),
			"session:r2": used(3),
			"command:c2": used(2),
			"session:p2": used(1),
		};
		expect(listed(paletteSections(items, "", frecency, NOW, 5))).toEqual([
			["suggestions", ["session:r1", "session:p1", "command:c1", "session:r2", "command:c2"]],
			["commands", ["command:c3"]],
			["past", ["session:p2"]],
		]);
	});

	test("pull requests list for a search or under Suggestions, under their own heading, and only when they hold every word", () => {
		const items = [
			item("session:r", "running", "Large old gardens in north"),
			item("pr:o/r#4", "pullRequests", "Ship login"),
			item("pr:o/r#5", "pullRequests", "Large old gardens in north"),
		];
		expect(listed(paletteSections(items, "", {}, NOW))).toEqual([["running", ["session:r"]]]);
		expect(listed(paletteSections(items, "", { "pr:o/r#4": { count: 3, last: NOW } }, NOW, 5))).toEqual([
			["suggestions", ["pr:o/r#4"]],
			["running", ["session:r"]],
		]);
		const found = paletteSections(items, "login", {}, NOW);
		expect(found.map(section => [section.heading, section.items.map(entry => entry.id)]).toSorted()).toEqual([
			["Pull requests", ["pr:o/r#4"]],
			["Running", ["session:r"]],
		]);
	});

	test("conversation matches list for a search only, in the server's order whatever the fuzzy match scores, after the ranked sections", () => {
		const items = [
			item("conversation:b", "conversations", "unrelated words"),
			item("conversation:a", "conversations", "deploy deploy deploy"),
			item("session:r", "running", "Deploy web"),
		];
		expect(listed(paletteSections(items, "", { "conversation:a": { count: 9, last: NOW } }, NOW, 5))).toEqual([["running", ["session:r"]]]);
		expect(listed(paletteSections(items, "deploy", {}, NOW))).toEqual([
			["running", ["session:r"]],
			["conversations", ["conversation:b", "conversation:a"]],
		]);
	});
});

describe("paletteCommands", () => {
	test("lists the shortcuts with a command title and a handler, less those unavailable now", () => {
		const handlers: ShortcutHandlers = { sessions: noop, "pull-requests": noop, restore: noop, closeTab: noop, help: noop };
		expect(paletteCommands(handlers, new Set()).map(({ id }) => id)).toEqual(["help", "pull-requests", "sessions"]);
		expect(paletteCommands(handlers, new Set(["sessions"])).map(({ id }) => id)).toEqual(["help", "pull-requests"]);
	});

	test("the focused-session goal command uses the normal availability filter", () => {
		const handlers: ShortcutHandlers = { setGoal: noop };
		expect(paletteCommands(handlers, new Set()).map(({ id, command }) => ({ id, command }))).toEqual([{ id: "setGoal", command: "Set or edit goal" }]);
		expect(paletteCommands(handlers, new Set(["setGoal"]))).toEqual([]);
	});
});

describe("chordAction", () => {
	const keyEvent = (key: string, code: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({
		key,
		code,
		ctrlKey: !!mods.ctrl,
		altKey: false,
		metaKey: false,
		shiftKey: !!mods.shift,
	});
	const entry: PaletteItem = { ...item("session:a", "running", "a"), actions: [[action("open"), action("split")], [action("pin", { key: "p", mod: true, shift: true })]] };

	test("Mod+Enter runs the second action and an action's own chord runs it, while Enter is left to the list", () => {
		expect(chordAction(entry, keyEvent("Enter", "Enter", { ctrl: true }), false)?.id).toBe("split");
		expect(chordAction(entry, keyEvent("P", "KeyP", { ctrl: true, shift: true }), false)?.id).toBe("pin");
		expect(chordAction(entry, keyEvent("Enter", "Enter"), false)).toBeUndefined();
		expect(chordAction(entry, keyEvent("p", "KeyP", { ctrl: true }), false)).toBeUndefined();
	});
});

describe("paletteSections matching", () => {
	const described = (base: PaletteItem, extra: Partial<PaletteItem>): PaletteItem => ({ ...base, ...extra });

	test("a search that matches only an item's subtitle or keywords still lists it", () => {
		const items = [
			described(item("session:s", "running", "Notes"), { subtitle: "kubernetes rollout" }),
			described(item("command:k", "commands", "Open settings"), { keywords: ["kubernetes"] }),
			item("session:x", "running", "Notes"),
		];
		expect(listed(paletteSections(items, "kubernetes", {}, NOW)).toSorted()).toEqual([
			["commands", ["command:k"]],
			["running", ["session:s"]],
		]);
	});

	test("an item the search does not match is absent", () => {
		const items = [item("session:r", "running", "Deploy web"), item("command:c", "commands", "Open settings")];
		expect(listed(paletteSections(items, "zzqx", {}, NOW))).toEqual([]);
	});

	test("a searched item lists only when it holds every typed word, which may sit across its title, subtitle and keywords", () => {
		const items = [
			item("pr:one-word", "pullRequests", "Fix login"),
			described(item("pr:split", "pullRequests", "Fix login"), { subtitle: "deploy pipeline" }),
			described(item("settings:split", "settings", "Login"), { keywords: ["deploy"] }),
		];
		expect(listed(paletteSections(items, "login deploy", {}, NOW)).toSorted()).toEqual([
			["pullRequests", ["pr:split"]],
			["settings", ["settings:split"]],
		]);
	});

	test("frecency lifts a section whose best match ties another's above it", () => {
		const items = [item("session:r", "running", "Deploy web"), item("session:p", "past", "Deploy web")];
		expect(listed(paletteSections(items, "deploy", {}, NOW))).toEqual([
			["running", ["session:r"]],
			["past", ["session:p"]],
		]);
		expect(listed(paletteSections(items, "deploy", { "session:p": { count: 2, last: NOW } }, NOW))).toEqual([
			["past", ["session:p"]],
			["running", ["session:r"]],
		]);
	});
});
