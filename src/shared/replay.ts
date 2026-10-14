import { normalizeRoots } from "../../templates/omp/agent/extensions/replay/replay-paths";
export { normalizeRoots } from "../../templates/omp/agent/extensions/replay/replay-paths";
export { replayMarkerOf, requestCheckOf } from "../../templates/omp/agent/extensions/replay/replay-metadata";
import type { ModelOption } from "./models";
import type { PromptImage } from "./sessions";
import { totalTokens } from "./trajectory";
import type { Turn, TurnStep } from "./trajectory";

export const REPLAY_MARKER = "omp-agents-replay";
export const REPLAY_CHECK = "omp-agents-replay-check";
export const REPLAY_BLOCK = "omp-agents-replay-block";
export interface ReplayRoots { original: string[]; replay: string }
export type RequestCheck =
	| { status: "match" | "mismatch"; rawEqual: boolean; originalHash: string; replayHash: string; normalizedOriginal: string; normalizedReplay: string; differences: string[] }
	| { status: "unknown"; reason: string; rawEqual: boolean | null; originalHash?: string; replayHash?: string };
export interface ReplayMarker {
	v: 1;
	id: string;
	source: { sessionId: string; file: string; turnId: string; at: number };
	roots: ReplayRoots;
	base: { sha: string; how: "reflog" | "head-now" };
	model: ModelOption;
	thinking: string | null;
	promptEdited: boolean;
	repaired: boolean;
	modelChanged: boolean;
	original: { api: string | null; model: string | null; hash: string; bodyRef: string } | null;
	originalTurnRef: string;
}
export interface ReplayFacts { marker: ReplayMarker; request: RequestCheck | null; turnId: string | null }
export interface ReplayDetail {
	token: string;
	sessionId: string;
	cwd: string;
	prompt: string;
	images: PromptImage[];
	model: ModelOption | null;
	thinking: string | null;
}
export interface ReplayComparison {
	facts: ReplayFacts;
	original: Turn;
	replay: Turn | null;
	requestBodies: { original: unknown; replay: unknown };
}
type Tool = Extract<TurnStep, { kind: "tool" }>;
export interface ToolPair { original: Tool | null; replay: Tool | null; same: boolean }
export function compareTurns(original: Turn, replay: Turn, roots: ReplayRoots) {
	const tools = (turn: Turn): Tool[] => turn.steps.filter((step): step is Tool => step.kind === "tool");
	const a = tools(original), b = tools(replay);
	const normalize = (text: string) => normalizeRoots(text, [...roots.original, roots.replay]);
	const pairs: ToolPair[] = [];
	const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
	for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
		lengths[i]![j] = a[i]!.name === b[j]!.name ? 1 + lengths[i + 1]![j + 1]! : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
	}
	let i = 0, j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i]!.name === b[j]!.name) {
			const left = a[i++]!, right = b[j++]!;
			pairs.push({ original: left, replay: right, same: left.args.cut === 0 && right.args.cut === 0 && normalize(left.args.text) === normalize(right.args.text) });
		} else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) pairs.push({ original: a[i++]!, replay: null, same: false });
		else pairs.push({ original: null, replay: b[j++]!, same: false });
	}
	const final = (turn: Turn) => {
		const at = turn.steps.findLastIndex(step => step.kind === "request");
		const replies = turn.steps.slice(at + 1).filter((step): step is Extract<TurnStep, { kind: "reply" }> => step.kind === "reply");
		return replies.length ? { text: replies.map(step => step.body.text).join("\n"), cut: replies.reduce((sum, step) => sum + step.body.cut, 0) } : null;
	};
	const left = final(original), right = final(replay);
	return { tools: pairs, reply: { original: left, replay: right, same: left !== null && right !== null && left.cut === 0 && right.cut === 0 && normalize(left.text) === normalize(right.text) }, tokens: { original: totalTokens(original.usage), replay: totalTokens(replay.usage) }, cost: { original: original.usage.cost, replay: replay.usage.cost } };
}
