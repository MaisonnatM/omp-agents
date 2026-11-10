import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { View } from "../src/shared/sessions";
import { applyPaneMessage, retainPanes, shownViews, usePaneLoaded, useTranscript } from "./pane-store";

const view = (instanceId: string): View => ({ kind: "live", instanceId, agentId: null });

function Probe({ view: shown }: { view: View }) {
	const items = useTranscript(shown);
	const loaded = usePaneLoaded(shown);
	return <span>{loaded ? items.length : "empty"}</span>;
}

describe("pane store", () => {
	test("a message for a view the page does not show changes nothing, and closing a view drops what it held", () => {
		const shown = view("shown");
		const hidden = view("hidden");
		retainPanes([shown]);
		applyPaneMessage({ t: "items", view: hidden, reset: true, items: [], removed: [] });
		expect(renderToStaticMarkup(<Probe view={hidden} />)).toBe("<span>empty</span>");
		applyPaneMessage({ t: "items", view: shown, reset: true, items: [], removed: [] });
		expect(renderToStaticMarkup(<Probe view={shown} />)).toBe("<span>0</span>");
		retainPanes([]);
		expect(renderToStaticMarkup(<Probe view={shown} />)).toBe("<span>empty</span>");
	});
});

describe("shown views", () => {
	test("a view stays streamed until the last component showing it leaves, whatever object each one passed", () => {
		const views = shownViews();
		views.change(view("a"), 1);
		views.change(view("a"), 1);
		views.change(view("b"), 1);
		expect(views.snapshot()).toEqual([view("a"), view("b")]);
		views.change(view("a"), -1);
		expect(views.snapshot()).toEqual([view("a"), view("b")]);
		views.change(view("a"), -1);
		expect(views.snapshot()).toEqual([view("b")]);
	});

	test("the list keeps its identity between changes, so the page resends watch only when it changes", () => {
		const views = shownViews();
		views.change(view("a"), 1);
		const first = views.snapshot();
		expect(views.snapshot()).toBe(first);
		let heard = 0;
		views.subscribe(() => heard++);
		views.change(view("b"), 1);
		expect(views.snapshot()).not.toBe(first);
		expect(heard).toBe(1);
	});
});
