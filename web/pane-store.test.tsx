import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { View } from "../src/shared/sessions";
import { applyPaneMessage, retainPanes, usePane } from "./pane-store";

const view = (instanceId: string): View => ({ kind: "live", instanceId, agentId: null });

function Probe({ view: shown }: { view: View }) {
	const pane = usePane(shown);
	return <span>{pane.loaded ? pane.items.length : "empty"}</span>;
}

describe("pane store", () => {
	test("a message for a view the page does not show changes nothing, and closing a view drops what it held", () => {
		const shown = view("shown");
		const hidden = view("hidden");
		retainPanes([shown]);
		applyPaneMessage({ t: "items", view: hidden, reset: true, items: [] });
		expect(renderToStaticMarkup(<Probe view={hidden} />)).toBe("<span>empty</span>");
		applyPaneMessage({ t: "items", view: shown, reset: true, items: [] });
		expect(renderToStaticMarkup(<Probe view={shown} />)).toBe("<span>0</span>");
		retainPanes([]);
		expect(renderToStaticMarkup(<Probe view={shown} />)).toBe("<span>empty</span>");
	});
});
