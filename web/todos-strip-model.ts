/** The words of the Todos card: its sections' headers and the one-line strip above the conversation that opens them, which repeats those headers' counts. */
import { SHIP_STAGES, type ShipProgress } from "../src/shared/sessions";
import type { TodoPhase, TodoTask } from "../src/shared/transcript";

export const STAGE_LABEL: Record<ShipProgress["stage"], string> = {
	ticket: "Ticket",
	plan: "Plan",
	implement: "Implement",
	draft_pr: "Draft PR",
	interface_review: "Interface review",
	thermonuclear: "Thermonuclear review",
	ready_gate: "Ready gate",
	live: "Live review",
	merged: "Merged",
};

export const WORK_LABEL: Record<NonNullable<ShipProgress["work"]>, string> = {
	rebase: "Rebasing",
	fix_comments: "Fixing review comments",
	fix_ci: "Fixing CI",
};

/** `1 File`, `7 Files`: a section's header and the strip's count of it. */
export const countLabel = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** How many of the /ship run's stages are done: those before the current one, or every one once merged. */
export const shipDone = (ship: ShipProgress): number => (ship.stage === "merged" ? SHIP_STAGES.length : SHIP_STAGES.indexOf(ship.stage));

/** `Step 8 of 9`, the current stage as the Ship section's stepper numbers it, or `null` once merged. */
export function shipStep(ship: ShipProgress): string | null {
	const done = shipDone(ship);
	return done >= SHIP_STAGES.length ? null : `Step ${done + 1} of ${SHIP_STAGES.length}`;
}

export const isClosed = (task: TodoTask): boolean => task.status === "completed" || task.status === "abandoned";

/** The todo list's count, `11/12`, done or dropped of all, and the task in progress. */
export function todoTally(phases: readonly TodoPhase[]): { count: string; done: number; total: number; current: TodoTask | undefined } {
	const all = phases.flatMap(phase => phase.tasks);
	const done = all.filter(isClosed).length;
	return { count: `${done}/${all.length}`, done, total: all.length, current: all.find(task => task.status === "in_progress") };
}

/** What the strip leads with: the /ship stage, the task in progress as Markdown, or the first count. */
export type StripLead = { kind: "ship"; stage: string; work: string | null; step: string | null } | { kind: "task"; markdown: string } | { kind: "count"; text: string };

export interface StripSummary {
	lead: StripLead;
	/** The counts after the lead, in the order of the sections; the strip drops them from the end as it narrows. */
	counts: string[];
}

export interface StripInput {
	ship: ShipProgress | null;
	phases: readonly TodoPhase[];
	subagents: number;
	files: number;
	images: number;
	sources: number;
}

/**
 * The strip's line: the /ship stage and its step, or else the task in progress, or else the first count, then the
 * counts of the sections in their order, each in its header's words; `null` while no section has anything to show.
 */
export function stripSummary({ ship, phases, subagents, files, images, sources }: StripInput): StripSummary | null {
	const tally = phases.length > 0 ? todoTally(phases) : null;
	const counts = [
		tally && `Todos ${tally.count}`,
		subagents > 0 && countLabel(subagents, "Subagent", "Subagents"),
		files > 0 && countLabel(files, "File", "Files"),
		images > 0 && countLabel(images, "Image", "Images"),
		sources > 0 && countLabel(sources, "Source", "Sources"),
	].filter((count): count is string => typeof count === "string");
	if (ship) {
		const step = shipStep(ship);
		return { lead: { kind: "ship", stage: STAGE_LABEL[ship.stage], work: ship.work ? WORK_LABEL[ship.work] : null, step: step && step.toLowerCase() }, counts };
	}
	if (tally?.current) return { lead: { kind: "task", markdown: tally.current.content }, counts };
	const [first, ...rest] = counts;
	return first === undefined ? null : { lead: { kind: "count", text: first }, counts: rest };
}
