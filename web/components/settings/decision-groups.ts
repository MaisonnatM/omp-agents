/** Which decision records the All workspaces view shows, one group per workspace that has records. */
import type { DecisionRecord, DecisionRecords } from "../../../src/shared/models";

/** Statuses of a record that no longer applies, which **In force** hides. */
export const RETIRED: Record<string, true> = { superseded: true, deprecated: true, rejected: true };

/** One workspace's answer from `GET /api/decisions`. `data` is null when `error` is set. */
export interface DecisionRead {
	cwd: string;
	cwdDisplay: string;
	data: DecisionRecords | null;
	error: string | null;
}

/** A workspace that loaded records, or one whose read failed. A workspace with no records directory is neither. */
export type DecisionGroup =
	| { cwd: string; cwdDisplay: string; error: string }
	| { cwd: string; cwdDisplay: string; error: null; dir: string; dirDisplay: string; records: DecisionRecord[] };

/**
 * Groups `reads` in order. A workspace with no records directory, or an empty one, counts in `empty` and is left out.
 * A failed read stays, so one repository's error does not hide the others.
 */
export function decisionGroups(reads: readonly DecisionRead[]): { groups: DecisionGroup[]; empty: number } {
	const groups: DecisionGroup[] = [];
	let empty = 0;
	for (const read of reads) {
		if (read.data === null) {
			groups.push({ cwd: read.cwd, cwdDisplay: read.cwdDisplay, error: read.error ?? "No answer" });
			continue;
		}
		const { dir, dirDisplay, records } = read.data;
		if (dir === null || records.length === 0) {
			empty += 1;
			continue;
		}
		groups.push({ cwd: read.cwd, cwdDisplay: read.cwdDisplay, error: null, dir, dirDisplay: dirDisplay ?? dir, records });
	}
	return { groups, empty };
}

/** Records the search and the **In force** switch leave visible, and how many matching records that switch hides. */
export function visibleRecords(records: readonly DecisionRecord[], query: string, inForce: boolean): { shown: readonly DecisionRecord[]; hidden: number } {
	const needle = query.trim().toLowerCase();
	const matching = needle ? records.filter(record => `${record.title} ${record.name} ${record.status ?? ""} ${record.body}`.toLowerCase().includes(needle)) : records;
	const shown = inForce ? matching.filter(record => record.status === null || RETIRED[record.status] !== true) : matching;
	return { shown, hidden: matching.length - shown.length };
}

/** The row's DOM id. `scope` is the workspace when several are listed, so two repositories may share a file name. */
export function decisionDomId(scope: string | null, name: string): string {
	return scope === null ? `decision-${name}` : `decision-${encodeURIComponent(scope)}-${name}`;
}

/** The expand set's key, scoped like {@link decisionDomId}. */
export function decisionKey(scope: string | null, name: string): string {
	return scope === null ? name : `${scope}\0${name}`;
}
