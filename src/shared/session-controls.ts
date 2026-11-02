import { isObject } from "../json";

export type ContextAction =
	| { kind: "compact"; mode: "soft" | "remote" | "snapcompact" | null }
	| { kind: "shake"; mode: "elide" | "images" | "thinking" }
	| { kind: "handoff" };

export interface CompactionState {
	auto: boolean;
	running: "manual" | "auto" | null;
	thresholdTokens: number | null;
}

export interface AdvisorState {
	enabled: boolean;
	model: string;
}

export interface SessionGoal {
	objective: string;
	status: "active" | "paused" | "budget-limited" | "complete";
	tokensUsed: number;
	tokenBudget: number | null;
	timeUsedSeconds: number;
}

export type GoalSlot =
	| { kind: "off"; reason: string }
	| { kind: "none"; continues: boolean }
	| { kind: "set"; goal: SessionGoal; continues: boolean };

export type GoalChange =
	| { op: "set"; objective: string; tokenBudget: number | null }
	| { op: "pause" | "resume" | "clear" };

export function parseContextAction(value: unknown): ContextAction | null {
	if (!isObject(value)) return null;
	if (value.kind === "handoff") return { kind: "handoff" };
	if (value.kind === "compact" && (value.mode === null || value.mode === "soft" || value.mode === "remote" || value.mode === "snapcompact")) return { kind: "compact", mode: value.mode };
	if (value.kind === "shake" && (value.mode === "elide" || value.mode === "images" || value.mode === "thinking")) return { kind: "shake", mode: value.mode };
	return null;
}

export function parseGoalChange(value: unknown): GoalChange | null {
	if (!isObject(value)) return null;
	if (value.op === "pause" || value.op === "resume" || value.op === "clear") return { op: value.op };
	if (value.op !== "set" || typeof value.objective !== "string" || !value.objective.trim()) return null;
	if (value.tokenBudget !== null && !(typeof value.tokenBudget === "number" && Number.isSafeInteger(value.tokenBudget) && value.tokenBudget > 0)) return null;
	return { op: "set", objective: value.objective.trim(), tokenBudget: value.tokenBudget };
}

export const contextCommand = (action: ContextAction): string => action.kind === "compact" ? `/compact${action.mode ? ` ${action.mode}` : ""}` : action.kind === "shake" ? `/shake ${action.mode}` : "/handoff";

/** A local /goal command, never a prompt for the model. Budget changes replace the goal over RPC. */
export function goalCommand(text: string, current: SessionGoal | null): GoalChange | "show" | null {
	const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (!match) return null;
	const args = match[1]?.trim() ?? "";
	if (!args || args === "show") return "show";
	if (args === "pause" || args === "resume") return { op: args };
	if (args === "drop" || args === "clear") return { op: "clear" };
	if (/^budget(?:\s|$)/.test(args)) {
		if (!current) throw new Error("Set a goal before changing its budget.");
		const raw = args.slice(6).trim();
		const budget = raw === "none" ? null : Number(raw);
		const change = parseGoalChange({ op: "set", objective: current.objective, tokenBudget: budget });
		if (!change) throw new Error("Use /goal budget <positive token count> or /goal budget none.");
		return change;
	}
	const objective = args.replace(/^(?:set|create)\s+/, "").trim();
	if (objective === "set" || objective === "create") throw new Error("Enter an objective after /goal set.");
	return { op: "set", objective, tokenBudget: null };
}
