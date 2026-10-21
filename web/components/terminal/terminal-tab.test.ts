import { expect, test } from "bun:test";
import type { TerminalInfo } from "../../../src/shared/terminals";
import { closeEndsShell, nextTabState, type TerminalTabState } from "./terminal-tab";

const terminal: TerminalInfo = { id: "t1", cwd: "/work", cwdDisplay: "~/work", title: null };
const starting: TerminalTabState = { phase: "starting" };
const connected: TerminalTabState = { phase: "connected", terminal };

test("closing a tab whose shell has not opened yet asks the shell to exit and keeps the tab until its socket closes", () => {
	expect(closeEndsShell(starting)).toBe(true);
	const closing = nextTabState(starting, { t: "close" });
	expect(closing).toEqual({ phase: "closing", terminal: null });
	const opened = nextTabState(closing!, { t: "opened", terminal });
	expect(opened).toEqual({ phase: "closing", terminal });
	expect(nextTabState(opened!, { t: "closed", exited: true })).toBeNull();
});

test("closing a connected tab asks its shell to exit and removes the tab once the socket closes, with or without the exit", () => {
	expect(closeEndsShell(connected)).toBe(true);
	const closing = nextTabState(connected, { t: "close" });
	expect(closing).toEqual({ phase: "closing", terminal });
	expect(nextTabState(closing!, { t: "close" })).toEqual(closing);
	expect(nextTabState(closing!, { t: "closed", exited: false })).toBeNull();
});

test("a tab the server hung up on reads disconnected, and closing it only removes it", () => {
	const refused = nextTabState(starting, { t: "closed", exited: false });
	expect(refused).toEqual({ phase: "disconnected", terminal: null });
	const lost = nextTabState(connected, { t: "closed", exited: false });
	expect(lost).toEqual({ phase: "disconnected", terminal });
	expect(closeEndsShell(lost!)).toBe(false);
	expect(nextTabState(lost!, { t: "close" })).toBeNull();
});

test("a shell that exits removes its tab, and one that opens connects its tab", () => {
	expect(nextTabState(starting, { t: "opened", terminal })).toEqual(connected);
	expect(nextTabState(connected, { t: "closed", exited: true })).toBeNull();
});
