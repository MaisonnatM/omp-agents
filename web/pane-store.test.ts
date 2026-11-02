import { describe, expect, test } from "bun:test";
import type { View } from "../src/shared/sessions";
import { shownViews } from "./pane-store";

const live = (instanceId: string): View => ({ kind: "live", instanceId, agentId: null });

describe("shown views", () => {
	test("a view stays streamed until the last component showing it leaves, whatever object each one passed", () => {
		const views = shownViews();
		views.change(live("a"), 1);
		views.change(live("a"), 1);
		views.change(live("b"), 1);
		expect(views.snapshot()).toEqual([live("a"), live("b")]);
		views.change(live("a"), -1);
		expect(views.snapshot()).toEqual([live("a"), live("b")]);
		views.change(live("a"), -1);
		expect(views.snapshot()).toEqual([live("b")]);
	});

	test("the list keeps its identity between changes, so the page resends watch only when it changes", () => {
		const views = shownViews();
		views.change(live("a"), 1);
		const first = views.snapshot();
		expect(views.snapshot()).toBe(first);
		let heard = 0;
		views.subscribe(() => heard++);
		views.change(live("b"), 1);
		expect(views.snapshot()).not.toBe(first);
		expect(heard).toBe(1);
	});
});
