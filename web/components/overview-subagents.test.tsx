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

/** `html` without its `hidden` elements, such as a closed tooltip's content, which the page keeps mounted. */
function withoutHidden(html: string): string {
	for (let open = /<(\w+)[^>]*\shidden=""[^>]*>/.exec(html); open; open = /<(\w+)[^>]*\shidden=""[^>]*>/.exec(html)) {
		const tag = open[1];
		const tags = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
		tags.lastIndex = open.index + open[0].length;
		let depth = 1;
		let end = html.length;
		for (let next = tags.exec(html); next; next = tags.exec(html)) {
			depth += next[0].startsWith("</") ? -1 : 1;
			if (depth === 0) {
				end = next.index + next[0].length;
				break;
			}
		}
		html = html.slice(0, open.index) + html.slice(end);
	}
	return html;
}

/** The visible text of each subagent row, one string per row. */
function rowTexts(agents: AgentRow[]): string[] {
	const html = withoutHidden(renderToStaticMarkup(<SubagentsSection links={{ instanceId: "i1", agents, onOpen: () => {}, onCancel: null }} nodes={subagentTree(agents, null)} arenas={[]} />));
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
