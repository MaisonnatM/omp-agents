import { afterAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type AgentRow, EMPTY_QUEUE } from "../../src/shared/sessions";
import { subagentTree } from "../overview-subagents-model";
import { SubagentsSection } from "./overview-subagents";

// The section's fold lives in localStorage, which bun has none of.
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
afterAll(() => Reflect.deleteProperty(globalThis, "localStorage"));

const row = (id: string, fields: Partial<AgentRow>): AgentRow => ({
	id,
	kind: "task",
	parentId: null,
	status: "idle",
	activity: null,
	model: null,
	startedAt: null,
	endedAt: null,
	canMessage: false,
	queue: EMPTY_QUEUE,
	...fields,
});

/** The visible text of each subagent row, one string per row. */
function rowTexts(agents: AgentRow[]): string[] {
	const html = renderToStaticMarkup(<SubagentsSection links={{ instanceId: "i1", agents, onOpen: () => {}, onCancel: null }} nodes={subagentTree(agents, null)} arenas={[]} />);
	const list = html.slice(html.indexOf('aria-label="Subagents"'));
	return [...list.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map(([, inner]) => inner.replace(/<span class="sr-only">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

test("a row reads its name and what it is doing, then its model, type, and how long it ran", () => {
	const done = row("RawBuzzard", { activity: "Say hello", model: "anthropic/claude-haiku-5-5", startedAt: 0, endedAt: 5 * 60_000 });
	expect(rowTexts([done])).toEqual(["RawBuzzard Say hello Haiku 5.5 · task · 5m"]);
});

test("a row leaves out the model and the time it does not know", () => {
	expect(rowTexts([row("Quiet", { kind: "scout" })])).toEqual(["Quiet scout"]);
});
