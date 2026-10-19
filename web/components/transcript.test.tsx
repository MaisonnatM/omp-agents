import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActivityItem } from "../transcript-view";
import { ActivityGroup, ActivityVisibility, ToolsExpanded } from "./transcript";

const tool = (id: string, status: "running" | "ok" | "error", agents: string[] = []): ActivityItem => ({ id, kind: "tool", name: "bash", summary: `summary ${id}`, status, agents });
const thought: ActivityItem = { id: "t", kind: "thinking", text: "weighing options", streaming: false };

const render = (entries: ActivityItem[], { expanded = false, hideThinking = false } = {}) =>
	renderToStaticMarkup(
		<ToolsExpanded.Provider value={expanded}>
			<ActivityVisibility.Provider value={{ hideTools: false, hideThinking, toggleTools: () => {}, toggleThinking: () => {} }}>
				<ActivityGroup entries={entries} />
			</ActivityVisibility.Provider>
		</ToolsExpanded.Provider>,
	);

test("a running group stays open and marks each line with its tool's status", () => {
	const html = render([tool("a", "ok"), tool("b", "error"), tool("c", "running")]);
	expect(html).toContain("Working");
	expect(html.match(/data-status="\w+"/g)).toEqual(['data-status="running"', 'data-status="error"', 'data-status="running"']);
	expect(html).toContain("summary a");
});

test("a finished group counts its failures and opens only when tools are expanded or it spawned subagents", () => {
	const finished = [tool("a", "ok"), tool("b", "error")];
	const closed = render(finished);
	expect(closed).toContain("Ran 2 tools, 1 failed");
	expect(closed).not.toContain("summary a");
	expect(render(finished, { expanded: true })).toContain("summary a");
	expect(render([tool("a", "ok", ["agent-1"])])).toContain("data-subagents");
});

test("thinking shows as its own line unless hidden", () => {
	const entries = [thought, tool("a", "ok")];
	expect(render(entries, { expanded: true })).toContain("weighing options");
	const hidden = render(entries, { expanded: true, hideThinking: true });
	expect(hidden).not.toContain("weighing options");
	expect(hidden).toContain("summary a");
});
