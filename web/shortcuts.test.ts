import { expect, test } from "bun:test";
import { PICK_MODE_KEYS } from "../src/shared/desktop-bridge";
import { createShortcutStack, IS_MAC, pairing, SHORTCUT_CATEGORIES, SHORTCUTS, shortcutBindings, type ShortcutHandlers, shortcutsFor } from "./shortcuts";

type Mods = { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean };
const keyEvent = (key: string, code: string, mods: Mods = {}) => ({
	key,
	code,
	ctrlKey: !!mods.ctrl,
	altKey: !!mods.alt,
	metaKey: !!mods.meta,
	shiftKey: !!mods.shift,
});
const pressOn = (mac: boolean, key: string, code: string, mods: Mods = {}, previous: string | null = null) =>
	shortcutsFor(keyEvent(key, code, mods), previous, mac).map(({ id }) => id);
const press = (key: string, code: string, mods: Mods = {}) => pressOn(false, key, code, mods);

test("mod is ⌘ on macOS and Ctrl elsewhere, and a chord needs exactly its modifiers", () => {
	expect(press("b", "KeyB", { ctrl: true })).toEqual(["sessionsSidebar"]);
	expect(pressOn(true, "b", "KeyB", { meta: true })).toEqual(["sessionsSidebar"]);
	expect(press("b", "KeyB", { meta: true })).toEqual([]);
	expect(pressOn(true, "b", "KeyB", { ctrl: true })).toEqual([]);
	expect(press("b", "KeyB", { ctrl: true, alt: true })).toEqual([]);
	expect(press("B", "KeyB", { ctrl: true, shift: true })).toEqual(["detailsSidebar"]);
	expect(pressOn(true, "B", "KeyB", { meta: true, shift: true })).toEqual(["detailsSidebar"]);
	expect(press("n", "KeyN", { ctrl: true })).toEqual([]);
	expect(press("O", "KeyO", { ctrl: true, shift: true })).toEqual(["newSession", "ticketsNew"]);
	expect(pressOn(true, "O", "KeyO", { meta: true, shift: true })).toEqual(["newSession", "ticketsNew"]);
	expect(pressOn(true, "O", "KeyO", { ctrl: true, shift: true })).toEqual([]);
	expect(press("f", "KeyF", { ctrl: true })).toEqual(["find"]);
	expect(pressOn(true, "f", "KeyF", { meta: true })).toEqual(["find"]);
	// Off macOS, Ctrl+Shift+F is both: the sidebar's search takes it first, while the sidebar shows.
	expect(press("F", "KeyF", { ctrl: true, shift: true })).toEqual(["sessionSearch", "maximizePane"]);
	expect(pressOn(true, "F", "KeyF", { meta: true, shift: true })).toEqual(["sessionSearch"]);
	expect(pressOn(true, "F", "KeyF", { ctrl: true, shift: true })).toEqual(["maximizePane"]);
	expect(press("L", "KeyL", { ctrl: true, shift: true })).toEqual(["openBrowser"]);
	expect(pressOn(true, "L", "KeyL", { meta: true, shift: true })).toEqual(["openBrowser"]);
	expect(press("G", "KeyG", { ctrl: true, shift: true })).toEqual(["reviewChanges"]);
	expect(pressOn(true, "G", "KeyG", { meta: true, shift: true })).toEqual(["reviewChanges"]);
	expect(press("k", "KeyK", { ctrl: true })).toEqual(["switcher"]);
	expect(press("e", "KeyE", { ctrl: true })).toEqual(["tools"]);
	expect(press("E", "KeyE", { ctrl: true, shift: true })).toEqual(["hideTools"]);
	expect(press("t", "KeyT", { alt: true })).toEqual(["hideThinking"]);
	expect(pressOn(true, "†", "KeyT", { alt: true })).toEqual(["hideThinking"]);
	expect(pressOn(true, "k", "KeyK", { meta: true })).toEqual(["switcher"]);
	expect(press("K", "KeyK", { ctrl: true, shift: true })).toEqual(["copyPullRequestNumber"]);
	expect(press("k", "KeyK", { ctrl: true, alt: true })).toEqual([]);
	expect(press("b", "KeyB")).toEqual([]);
});

test("Ctrl+` toggles the terminal on every platform, and ⌘` stays macOS's window switch", () => {
	expect(press("`", "Backquote", { ctrl: true })).toEqual(["terminal"]);
	expect(pressOn(true, "`", "Backquote", { ctrl: true })).toEqual(["terminal"]);
	expect(pressOn(true, "`", "Backquote", { meta: true })).toEqual([]);
	expect(pressOn(true, "`", "Backquote", { ctrl: true, meta: true })).toEqual([]);
});

test("browser-reserved chords stay the browser's, apart from the app's tab, settings, and pull request copy bindings", () => {
	for (const mac of [false, true]) {
		const mod = mac ? { meta: true } : { ctrl: true };
		expect(pressOn(mac, "w", "KeyW", mod)).toEqual(["closeTab"]);
		expect(pressOn(mac, "t", "KeyT", mod)).toEqual(["newTab"]);
		expect(pressOn(mac, ",", "Comma", mod)).toEqual(["settings"]);
		expect(pressOn(mac, "W", "KeyW", { ...mod, shift: true })).toEqual([]);
		expect(pressOn(mac, "T", "KeyT", { ...mod, shift: true })).toEqual([]);
		expect(pressOn(mac, "X", "KeyX", { ...mod, shift: true })).toEqual([]);
		for (const [key, code] of [["n", "KeyN"], ["l", "KeyL"], ["r", "KeyR"], ["d", "KeyD"], ["o", "KeyO"], ["p", "KeyP"], ["s", "KeyS"], ["0", "Digit0"]]) {
			expect(pressOn(mac, key, code, mod)).toEqual([]);
		}
		expect(pressOn(mac, "K", "KeyK", { ...mod, shift: true })).toEqual(["copyPullRequestNumber"]);
		expect(pressOn(mac, "C", "KeyC", { ...mod, shift: true })).toEqual([]);
		// ⇧, types `<` on a US layout; the comma key still reads as the comma.
		expect(pressOn(mac, "<", "Comma", { ...mod, shift: true })).toEqual(["copyPullRequestLink"]);
	}
	// AZERTY types the comma on the M key, which ⌘ still reads as typed.
	expect(pressOn(true, ",", "KeyM", { meta: true })).toEqual(["settings"]);
});

test("⌘1–9 go to the header tabs and ⌥1–9 open the sidebar's sessions on macOS, Ctrl and Alt elsewhere, including AZERTY", () => {
	const azerty = ["&", "é", "\"", "'", "(", "-", "è", "_", "ç"];
	// macOS Option turns each digit into a symbol.
	const option = ["¡", "™", "£", "¢", "∞", "§", "¶", "•", "ª"];
	for (const mac of [false, true]) {
		const mod = mac ? { meta: true } : { ctrl: true };
		for (let index = 0; index < 9; index++) {
			const key = String(index + 1);
			const code = `Digit${key}`;
			expect(shortcutsFor(keyEvent(key, code, mod), null, mac)).toEqual([{ id: "selectTab", scope: "anywhere", key: index }]);
			expect(pressOn(mac, azerty[index]!, code, mod)).toEqual(["selectTab"]);
			expect(shortcutsFor(keyEvent(mac ? option[index]! : key, code, { alt: true }), null, mac)).toEqual([{ id: "jumpToSession", scope: "anywhere", key: index }]);
			expect(pressOn(mac, key, code)).toEqual(["answer"]);
			expect(pressOn(mac, key, code, { ...mod, shift: true })).toEqual([]);
			expect(pressOn(mac, key, code, { ...mod, alt: true })).toEqual([]);
			expect(pressOn(mac, key, code, { meta: true, ctrl: true })).toEqual([]);
		}
		expect(pressOn(mac, "0", "Digit0", mod)).toEqual([]);
		expect(pressOn(mac, "0", "Digit0", { alt: true })).toEqual([]);
	}
	expect(press(",", "Comma", { ctrl: true })).toEqual(["settings"]);
	expect(press("J", "KeyJ", { ctrl: true, shift: true })).toEqual([]);
});

test("a letter key that types no ASCII letter matches by its physical key, an ASCII symbol as typed", () => {
	expect(press("л", "KeyK", { ctrl: true })).toEqual(["switcher"]);
	expect(pressOn(true, "˚", "KeyK", { meta: true })).toEqual(["switcher"]);
	expect(press("?", "KeyM", { shift: true })).toEqual(["help"]);
	expect(press("?", "Slash", { shift: true })).toEqual(["help"]);
	expect(press("/", "Digit7", { shift: true })).toEqual(["focusComposer", "todoSearch"]);
	expect(pressOn(true, "÷", "Slash", { meta: true, alt: true })).toEqual(["model"]);
});

test("Cmd+Enter steers now, Enter queues when running, Cmd+. stops the turn, Option+M dictates, and Cmd+/ attaches files", () => {
	expect(press("Enter", "Enter", { ctrl: true })).toEqual(["steer", "deliverSteer"]);
	expect(press("Enter", "Enter", { meta: true })).toEqual([]);
	expect(pressOn(true, "Enter", "Enter", { meta: true })).toEqual(["steer", "deliverSteer"]);
	expect(pressOn(true, "Enter", "Enter", { ctrl: true })).toEqual([]);
	for (const mac of [false, true]) {
		const mod = mac ? { meta: true } : { ctrl: true };
		expect(pressOn(mac, "Enter", "Enter")).toEqual([]);
		expect(pressOn(mac, "Tab", "Tab", { shift: true })).toEqual(["thinking"]);
		expect(pressOn(mac, ".", "Period", mod)).toEqual(["interrupt"]);
		expect(pressOn(mac, "Backspace", "Backspace", { shift: true, ...mod })).toEqual([]);
		expect(pressOn(mac, "/", "Slash", mod)).toEqual(["attachFiles"]);
		expect(pressOn(mac, "M", "KeyM", { ...mod, shift: true })).toEqual([]);
	}
	expect(press("m", "KeyM", { alt: true })).toEqual(["dictate"]);
	expect(pressOn(true, "µ", "KeyM", { alt: true })).toEqual(["dictate"]);
});

test("a key matches only its intended scope, with no Esc interrupt, and Cmd+/ attaches files only from the composer", () => {
	expect(shortcutsFor(keyEvent("Escape", "Escape"), null, false)).toEqual([
		{ id: "restore", scope: "anywhere", key: 0 },
		{ id: "browserRestore", scope: "anywhere", key: 0 },
		{ id: "todoClose", scope: "outside-fields", key: 0 },
		{ id: "emailClose", scope: "outside-fields", key: 0 },
		{ id: "sportJournalClose", scope: "outside-fields", key: 0 },
	]);
	expect(shortcutsFor(keyEvent("/", "Slash", { ctrl: true }), null, false)).toEqual([{ id: "attachFiles", scope: "composer", key: 0 }]);
	expect(shortcutsFor(keyEvent("/", "Slash", { ctrl: true, alt: true }), null, false)).toEqual([{ id: "model", scope: "anywhere", key: 0 }]);
	expect(shortcutsFor(keyEvent("/", "Slash"), null, false)).toEqual([
		{ id: "focusComposer", scope: "outside-fields", key: 0 },
		{ id: "todoSearch", scope: "outside-fields", key: 0 },
	]);
	expect(shortcutsFor(keyEvent("i", "KeyI", { ctrl: true }), null, false)).toEqual([{ id: "focusComposer", scope: "anywhere", key: 1 }]);
	expect(press("i", "KeyI", { ctrl: true })).toEqual(["focusComposer"]);
	expect(shortcutsFor(keyEvent("s", "KeyS"), null, false)).toEqual([
		{ id: "newSession", scope: "outside-fields", key: 1 },
		{ id: "todoStatus", scope: "outside-fields", key: 0 },
	]);
});

test("↓ and ↑, or J and K, step through sessions, pull requests, todos, conversations, sport logs, and changed files, and ↑ also takes back a queued message", () => {
	expect(press("ArrowDown", "ArrowDown")).toEqual(["sessionsNext", "nextPullRequest", "todoNext", "emailNext", "sportJournalNext", "nextChangedFile"]);
	expect(press("ArrowUp", "ArrowUp")).toEqual(["dequeue", "sessionsPrevious", "previousPullRequest", "todoPrevious", "emailPrevious", "sportJournalPrevious", "previousChangedFile"]);
	expect(press("j", "KeyJ")).toEqual(["sessionsNext", "nextPullRequest", "todoNext", "emailNext", "sportJournalNext", "nextChangedFile"]);
	expect(press("k", "KeyK")).toEqual(["sessionsPrevious", "previousPullRequest", "todoPrevious", "emailPrevious", "sportJournalPrevious", "previousChangedFile"]);
	expect(shortcutsFor(keyEvent("j", "KeyJ"), null, false).map(({ scope }) => scope)).not.toContain("anywhere");
});

test("Cmd+Shift+P takes no shortcut, and Cmd+Alt+P opens the directory picker", () => {
	expect(press("P", "KeyP", { ctrl: true, shift: true })).toEqual([]);
	expect(pressOn(true, "P", "KeyP", { meta: true, shift: true })).toEqual([]);
	expect(press("p", "KeyP", { ctrl: true })).toEqual([]);
	expect(press("π", "KeyP", { ctrl: true, alt: true })).toEqual(["directory"]);
});

test("Cmd+[ and Cmd+] go back and forward, Cmd+Alt+↑↓ step through sessions, Cmd+Alt+←→ and Ctrl+Tab through header tabs, and Alt+Shift+arrows move a todo", () => {
	expect(press("[", "BracketLeft", { ctrl: true })).toEqual(["back"]);
	expect(press("]", "BracketRight", { ctrl: true })).toEqual(["forward"]);
	expect(press("ArrowUp", "ArrowUp", { ctrl: true, alt: true })).toEqual(["previousSession"]);
	expect(press("ArrowDown", "ArrowDown", { ctrl: true, alt: true })).toEqual(["nextSession"]);
	expect(press("ArrowLeft", "ArrowLeft", { ctrl: true, alt: true })).toEqual(["previousTab"]);
	expect(press("ArrowRight", "ArrowRight", { ctrl: true, alt: true })).toEqual(["nextTab"]);
	for (const mac of [false, true]) {
		expect(pressOn(mac, "Tab", "Tab", { ctrl: true })).toEqual(["nextTab"]);
		expect(pressOn(mac, "Tab", "Tab", { ctrl: true, shift: true })).toEqual(["previousTab"]);
	}
	expect(pressOn(true, "Tab", "Tab", { meta: true })).toEqual([]);
	expect(pressOn(true, "∑", "KeyW", { meta: true, alt: true })).toEqual(["closeOtherTabs"]);
	expect(press("w", "KeyW", { ctrl: true, alt: true })).toEqual(["closeOtherTabs"]);
	expect(press("ArrowUp", "ArrowUp", { alt: true })).toEqual([]);
	expect(press("ArrowUp", "ArrowUp", { alt: true, shift: true })).toEqual(["moveUp"]);
	expect(press("ArrowDown", "ArrowDown", { alt: true, shift: true })).toEqual(["moveDown"]);
});

test("the Browser's preload hands over exactly the keys of the pick mode shortcuts", () => {
	const ids = ["browserPickSelect", "browserPickRegion", "browserPickDraw", "browserPickErase"] as const;
	const keys = ids.flatMap(id => shortcutBindings(id).flatMap(binding => ("chord" in binding ? [binding.chord.key] : [])));
	expect(keys.toSorted()).toEqual([...PICK_MODE_KEYS].toSorted());
});

test("G then W or M goes to a page only right after a plain G, and P picks a todo's priority", () => {
	const after = (previous: string | null, key: string, mods: Mods = {}) => pressOn(false, key, `Key${key.toUpperCase()}`, mods, previous);
	// R alone switches the Browser's pick mode or replies on an open conversation, and a G before it changes nothing.
	expect(after("g", "r")).toEqual(["browserPickRegion", "emailReply"]);
	expect(after("g", "w")).toEqual(["workspace"]);
	expect(after("g", "m")).toEqual(["email"]);
	expect(pressOn(false, ",", "Comma", {}, "g")).toEqual([]);
	expect(pressOn(false, ",", "Comma")).toEqual([]);
	expect(after(null, "n")).toEqual([]);
	expect(after(null, "m")).toEqual([]);
	expect(after(null, "w")).toEqual([]);
	expect(after("h", "w")).toEqual([]);
	expect(after("g", "W", { shift: true })).toEqual([]);
	expect(after("g", "p")).toEqual(["todoPriority"]);
	expect(after(null, "p")).toEqual(["todoPriority"]);
	expect(after("g", "i", { ctrl: true })).toEqual(["focusComposer"]);
	expect(shortcutsFor(keyEvent("w", "KeyW"), "g", false)).toEqual([{ id: "workspace", scope: "outside-fields", key: 0 }]);
});

test("1 to 9 outside text fields answer the open question, and its handler learns which key was pressed", () => {
	for (const mac of [false, true]) {
		for (let digit = 1; digit <= 9; digit++) {
			const key = String(digit);
			expect(shortcutsFor(keyEvent(key, `Digit${key}`), null, mac)).toEqual([{ id: "answer", scope: "outside-fields", key: digit - 1 }]);
			expect(pressOn(mac, key, `Digit${key}`, { shift: true })).toEqual([]);
		}
		expect(pressOn(mac, "0", "Digit0")).toEqual([]);
	}
	const stack = createShortcutStack();
	const picked: number[] = [];
	stack.add(1, () => ({ answer: key => (key < 2 ? void picked.push(key) : false) }));
	stack.dispatch(pressed("2", "Digit2"), true, null);
	stack.dispatch(pressed("2", "Digit2"), false, null);
	const declined = pressed("3", "Digit3");
	stack.dispatch(declined, true, null);
	expect(picked).toEqual([1]);
	expect(declined.defaultPrevented).toBe(false);
});

test("a pair forms from a plain key outside text fields, within a second and a half", () => {
	const at = (timeStamp: number, key: string, mods: Mods = {}) => ({ ...keyEvent(key, `Key${key.toUpperCase()}`, mods), timeStamp });

	const quick = pairing();
	expect(quick(at(0, "g"), true)).toBe(null);
	expect(quick(at(400, "i"), true)).toBe("g");

	const slow = pairing();
	slow(at(0, "g"), true);
	expect(slow(at(1600, "i"), true)).toBe(null);

	const typed = pairing();
	typed(at(0, "g"), false);
	expect(typed(at(100, "i"), true)).toBe(null);

	const shifted = pairing();
	shifted(at(0, "G", { shift: true }), true);
	expect(shifted(at(100, "i"), true)).toBe(null);

	const broken = pairing();
	broken(at(0, "g"), true);
	broken(at(100, "x"), true);
	expect(broken(at(200, "i"), true)).toBe("x");
});

const pressed = (key: string, code: string, mods: Mods = {}) => {
	const event = { ...keyEvent(key, code, mods), defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) };
	return event;
};

test("the newest registration tries a key first, and the first handler that takes it ends the press", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({ nextPullRequest: () => void calls.push("app") }));
	stack.add(3, () => ({ todoNext: () => void calls.push("page") }));
	stack.add(2, () => ({ nextChangedFile: () => void calls.push("middle") }));
	const event = pressed("ArrowDown", "ArrowDown");
	stack.dispatch(event, true, null);
	expect(calls).toEqual(["page"]);
	expect(event.defaultPrevented).toBe(true);
});

test("a handler that declines passes the key to the registration below, and one that returns nothing takes it", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({ focusComposer: () => void calls.push("app") }));
	stack.add(2, () => ({ todoSearch: () => (calls.push("page"), false) }));
	const event = pressed("/", "Slash");
	stack.dispatch(event, true, null);
	expect(calls).toEqual(["page", "app"]);
	expect(event.defaultPrevented).toBe(true);
	const declined = pressed("/", "Slash");
	const empty = createShortcutStack();
	empty.add(1, () => ({ todoSearch: () => false }));
	empty.dispatch(declined, true, null);
	expect(declined.defaultPrevented).toBe(false);
});

test("a registration reads its handlers when the key is pressed, and removing it returns the key to the one below", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	let handlers: ShortcutHandlers = {};
	stack.add(1, () => ({ newTicket: () => void calls.push("app") }));
	const remove = stack.add(2, () => handlers);
	expect(stack.size).toBe(2);
	stack.dispatch(pressed("c", "KeyC"), true, null);
	expect(calls).toEqual(["app"]);
	handlers = { todoNew: () => void calls.push("page") };
	stack.dispatch(pressed("c", "KeyC"), true, null);
	expect(calls).toEqual(["app", "page"]);
	remove();
	expect(stack.size).toBe(1);
	stack.dispatch(pressed("c", "KeyC"), true, null);
	expect(calls).toEqual(["app", "page", "app"]);
});

test("scope limits who runs: text fields keep their keys, chords work anywhere, and composer bindings never reach the page", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({
		newTicket: () => void calls.push("ticket"),
		switcher: () => void calls.push("switcher"),
		interrupt: () => void calls.push("interrupt"),
	}));
	const mod = IS_MAC ? { meta: true } : { ctrl: true };
	stack.dispatch(pressed("c", "KeyC"), false, null);
	stack.dispatch(pressed("k", "KeyK", mod), false, null);
	stack.dispatch(pressed("Backspace", "Backspace", { ...mod, shift: true }), true, null);
	expect(calls).toEqual(["switcher"]);
});

test("a key something nearer already handled is left alone", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({ newTicket: () => void calls.push("app") }));
	const event = pressed("c", "KeyC");
	event.preventDefault();
	stack.dispatch(event, true, null);
	expect(calls).toEqual([]);
});

test("every section of Settings › Keyboard lists at least one shortcut", () => {
	const empty = SHORTCUT_CATEGORIES.filter(({ id }) => !SHORTCUTS.some(({ category }) => category === id)).map(({ id }) => id);
	expect(empty).toEqual([]);
});

test("the Keyboard tab's rule holds: modifier chords work anywhere, single keys and G pairs outside text fields, apart from composer keys and Esc", () => {
	const broken = SHORTCUTS.flatMap(({ id, keys }) =>
		keys.filter(binding => {
			if ("goTo" in binding) return false;
			const { chord, scope } = binding;
			if (scope === "composer") return false;
			if (chord.mod || chord.ctrl || chord.alt) return scope !== "anywhere";
			return scope !== "outside-fields" && chord.key !== "Escape";
		}).map(() => id),
	);
	expect(broken).toEqual([]);
});

test("the command palette runs a command as its keys do: the highest registration first, until one takes it", () => {
	const stack = createShortcutStack();
	const ran: string[] = [];
	stack.add(0, (): ShortcutHandlers => ({ newTab: () => void ran.push("app"), settings: () => void ran.push("settings") }));
	const remove = stack.add(1, (): ShortcutHandlers => ({ newTab: () => false, closeTab: () => void ran.push("dialog") }));
	const handlers = stack.handlers();
	expect(Object.keys(handlers).toSorted()).toEqual(["closeTab", "newTab", "settings"]);
	expect(handlers.newTab?.(0)).toBe(true);
	expect(ran).toEqual(["app"]);
	remove();
	expect(handlers.closeTab?.(0)).toBe(false);
	expect(ran).toEqual(["app"]);
});
