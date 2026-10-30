// omp-agents session visuals: tells a session the dashboard started which fenced blocks its conversation draws as a
// diagram or a chart. The dashboard loads it with `omp -e` (`withSessionVisuals` in src/dashboard-session.ts), so a
// session started in a terminal never reads it.
import { MAX_CHART_ROWS, MAX_CHART_SERIES, MAX_MERMAID_SOURCE } from "../shared/session-visuals";

/** The part of omp's `ExtensionAPI` this uses, by hand: `tsc` cannot resolve omp's own package here. */
interface ExtensionApi {
	on(event: "before_agent_start", handler: (event: { systemPrompt: string[] }) => { systemPrompt: string[] }): void;
}

const VISUALS_PROMPT = [
	"This session's conversation is shown in the omp-agents dashboard, which draws two kinds of fenced code block in a message as a picture; use one only when a diagram or a chart makes the answer clearer than text.",
	`- \`\`\`mermaid: a flowchart (\`graph TD\` or \`flowchart LR\`, with any of TD, TB, LR, BT, RL), \`sequenceDiagram\`, \`stateDiagram-v2\`, \`classDiagram\`, or \`erDiagram\`, as the first line, in at most ${MAX_MERMAID_SOURCE.toLocaleString("en-US")} characters. Other diagram types, such as pie, gantt, and xychart, are not drawn.`,
	`- \`\`\`chart: one JSON object, \`{"type": "bar" | "line" | "area" | "pie", "title"?: string, "description"?: string, "x": string, "series": [{"key": string, "label"?: string}], "data": [{...}]}\`, with no other keys and no comments. Each row holds exactly the \`x\` key, a string or a number, and every series key, a finite number. Keys use letters, digits, _ and -. There are 1 to ${MAX_CHART_SERIES} series and 1 to ${MAX_CHART_ROWS} rows; a pie has exactly one series, and its \`x\` names each slice.`,
	"A block that breaks these rules shows as its source with the error.",
	'After you change something a person should look at in the app, such as a page, a dialog, or a layout, end your reply with a ```review-pages block: a JSON array of `{"label": string, "url": string, "note"?: string}`, one per page to look at, at most 8. Each `url` is the running dev server on this computer (`http://localhost:<port>/...`); `note` says how to reach a state the address cannot open, such as "Click Settings, then open the Sync tab". The dashboard shows a Review visuals button that opens each page in its own Browser tab.',
].join("\n");

export default function sessionVisuals(pi: ExtensionApi): void {
	pi.on("before_agent_start", event => ({ systemPrompt: [...event.systemPrompt, VISUALS_PROMPT] }));
}
