import { expect, test } from "bun:test";
import type { TerminalInfo } from "../../../src/shared/terminals";
import { ApiError } from "../../api";
import { readTerminalTabs } from "./terminal-inventory";
import type { Tab } from "./terminal-tab";

const running: TerminalInfo = { id: "t1", cwd: "/work", cwdDisplay: "~/work" };
const restored: Tab = { key: "t1", target: { id: "t1" }, state: { phase: "connected", terminal: running } };

test("a failed read of the running shells reports the failure and starts no shell", async () => {
	let asked = false;
	const tabs = await readTerminalTabs(
		() => Promise.reject(new ApiError("Unauthorized")),
		() => {
			asked = true;
			return "/home";
		},
		() => true,
	);
	expect(tabs).toEqual({ state: "failed", error: "Unauthorized" });
	expect(asked).toBe(false);
});

test("only a successful empty read starts one new shell in the current directory", async () => {
	const tabs = await readTerminalTabs(
		() => Promise.resolve([]),
		() => "/home",
		() => false,
	);
	expect(tabs).toMatchObject({ state: "ready", tabs: [{ target: { cwd: "/home" }, state: { phase: "starting" } }] });
});

test("a read that lists shells reopens a tab for each and starts none", async () => {
	const tabs = await readTerminalTabs(
		() => Promise.resolve([running]),
		() => "/home",
		() => false,
	);
	expect(tabs).toEqual({ state: "ready", tabs: [restored] });
});

test("a new shell asked for starts after the running ones, and only one when none runs", async () => {
	const after = await readTerminalTabs(
		() => Promise.resolve([running]),
		() => "/home",
		() => true,
	);
	expect(after).toMatchObject({ state: "ready", tabs: [restored, { target: { cwd: "/home" }, state: { phase: "starting" } }] });
	const alone = await readTerminalTabs(
		() => Promise.resolve([]),
		() => "/home",
		() => true,
	);
	expect(alone.state === "ready" && alone.tabs.length).toBe(1);
});
