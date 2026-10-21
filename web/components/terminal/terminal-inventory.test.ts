import { expect, test } from "bun:test";
import type { TerminalInfo } from "../../../src/shared/terminals";
import { ApiError } from "../../api";
import { readTerminalTabs } from "./terminal-inventory";

const running: TerminalInfo = { id: "t1", cwd: "/work", cwdDisplay: "~/work", title: null };

test("a failed read of the running shells reports the failure and starts no shell", async () => {
	let asked = false;
	const tabs = await readTerminalTabs(
		() => Promise.reject(new ApiError("Unauthorized")),
		() => {
			asked = true;
			return "/home";
		},
	);
	expect(tabs).toEqual({ state: "failed", error: "Unauthorized" });
	expect(asked).toBe(false);
});

test("only a successful empty read starts one new shell in the current directory", async () => {
	const tabs = await readTerminalTabs(
		() => Promise.resolve([]),
		() => "/home",
	);
	expect(tabs).toMatchObject({ state: "ready", tabs: [{ target: { cwd: "/home" }, state: { phase: "starting" } }] });
});

test("a read that lists shells reopens a tab for each and starts none", async () => {
	const tabs = await readTerminalTabs(
		() => Promise.resolve([running]),
		() => "/home",
	);
	expect(tabs).toEqual({ state: "ready", tabs: [{ key: "t1", target: { id: "t1" }, state: { phase: "connected", terminal: running } }] });
});
