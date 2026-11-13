import { describe, expect, test } from "bun:test";
import { closeDetailsTab, decodeDetailsTabs, encodeDetailsTabs, showDetailsTab } from "./details-tabs";

describe("decodeDetailsTabs", () => {
	test("a tab name stored before tabs could close opens that tab", () => {
		expect(decodeDetailsTabs("pull-requests")).toEqual({ open: ["pull-requests"], active: "pull-requests" });
	});

	test("reads back what it stored, dropping an active tab that is not open", () => {
		const tabs = { open: ["pull-requests", "artifacts"], active: "artifacts" };
		expect(decodeDetailsTabs(encodeDetailsTabs(tabs))).toEqual(tabs);
		expect(decodeDetailsTabs(JSON.stringify({ open: ["pull-requests"], active: "browser" }))).toEqual({ open: ["pull-requests"], active: null });
	});
});

describe("showDetailsTab", () => {
	test("shows an open tab without adding it twice", () => {
		expect(showDetailsTab({ open: ["pull-requests", "artifacts"], active: "artifacts" }, "pull-requests", "overview")).toEqual({ open: ["pull-requests", "artifacts"], active: "pull-requests" });
	});

	test("opens a tab that is not open as the last one", () => {
		expect(showDetailsTab({ open: ["pull-requests"], active: null }, "browser", "overview")).toEqual({ open: ["pull-requests", "browser"], active: "browser" });
	});

	test("shows the first tab without adding it to the open tabs", () => {
		expect(showDetailsTab({ open: ["pull-requests"], active: "pull-requests" }, "overview", "overview")).toEqual({ open: ["pull-requests"], active: null });
	});
});

describe("closeDetailsTab", () => {
	const shown = ["overview", "pull-requests", "artifacts"];

	test("closing the tab on screen shows the one before it, skipping a tab the view hides", () => {
		const tabs = { open: ["pull-requests", "browser", "artifacts"], active: "artifacts" };
		expect(closeDetailsTab(tabs, "artifacts", shown)).toEqual({ open: ["pull-requests", "browser"], active: "pull-requests" });
	});

	test("closing the first open tab on screen shows the first tab", () => {
		expect(closeDetailsTab({ open: ["pull-requests", "artifacts"], active: "pull-requests" }, "pull-requests", shown)).toEqual({ open: ["artifacts"], active: null });
	});

	test("closing a tab behind the one on screen keeps it on screen", () => {
		expect(closeDetailsTab({ open: ["pull-requests", "artifacts"], active: "artifacts" }, "pull-requests", shown)).toEqual({ open: ["artifacts"], active: "artifacts" });
	});
});
