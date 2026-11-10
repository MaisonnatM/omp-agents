/** The words of the Todos card's section headers: the /ship stage and step, the todo list's count, and each list's count. */
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

/** `1 File`, `7 Files`: a section's header count. */
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
