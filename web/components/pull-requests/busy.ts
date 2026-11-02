/** What a pull request is busy with on this page, which its row, card, and details header show in place of its move. */
import type { PullRequest } from "../../../src/shared/github";
import { type RebaseState, useRebaseState } from "../../pull-request-rebases";
import { QUICK_ACTIONS, type QuickActionId } from "../../quick-actions";

/** A rebase in the queue, or a quick action whose session is starting. */
export type Busy = { kind: "rebase"; state: RebaseState } | { kind: "start"; action: QuickActionId };

/** How a busy pull request reads: `label` in full, and `short`, which fits a row's fixed-width move badge. */
export interface BusyWords {
	label: string;
	short: string;
}

const REBASE_WORDS: Record<RebaseState, BusyWords> = {
	queued: { label: "Queued to rebase", short: "Queued" },
	running: { label: "Rebasing", short: "Rebasing" },
};

export const busyWords = (busy: Busy): BusyWords =>
	busy.kind === "rebase" ? REBASE_WORDS[busy.state] : { label: `Starting ${QUICK_ACTIONS[busy.action].label}`, short: "Starting" };

/** What `pr` is busy with: its rebase, which runs for minutes, before `pending`, the start its row or details wait on. */
export function useBusy(pr: PullRequest, pending: QuickActionId | null): Busy | null {
	const state = useRebaseState(pr);
	if (state) return { kind: "rebase", state };
	return pending ? { kind: "start", action: pending } : null;
}
