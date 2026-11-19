/**
 * The Memory page's project memory: each workspace repository's `refs/omp/memory`, read and changed with the
 * `project_memory` tool's own code, so an edit from the page is checked and recorded as the tool's are. See
 * docs/architecture/memory-page.md.
 */
import { applyMemoryOps, type Memory, memoryTip, parseOps, type RawOp, readMemory } from "../templates/omp/agent/extensions/project-memory/memory";
import { placeOf } from "../templates/omp/agent/extensions/project-memory/repo";
import { isObject } from "./json";
import { displayPath } from "./paths";
import { localDay } from "./shared/days";
import type { ProjectMemoryEntry, ProjectMemoryRepo, ProjectMemoryView } from "./shared/memory-page";

/** The session name an edit from the page records, so its memories' source reads `#dashboard`. */
export const DASHBOARD_SOURCE = "dashboard";

/** An edit the page sent that the memory refuses, with every reason. */
export class MemoryEditRefused extends Error {}

const byNewest = (a: ProjectMemoryEntry, b: ProjectMemoryEntry): number => (a.updated !== b.updated ? (a.updated < b.updated ? 1 : -1) : a.slug < b.slug ? -1 : 1);

/** The repository whose main checkout is `root`: its memories, newest first; `null` when `root` is not in a git repository. */
function repoOf(root: string): ProjectMemoryRepo | null {
	const place = placeOf(root);
	if (!place) return null;
	const { memories } = readMemory(place.root.commonDir, memoryTip(place.root.commonDir));
	const entries = Object.entries(memories).map(([slug, memory]: [string, Memory]) => ({ slug, ...memory }));
	return { root, rootDisplay: displayPath(root), name: place.root.name, memories: entries.sort(byNewest) };
}

/** Every repository among `roots`, each a main checkout: those with memories first, then by name. */
export function projectMemoryView(roots: readonly string[]): ProjectMemoryView {
	const repos = roots.flatMap(root => repoOf(root) ?? []);
	repos.sort((a, b) => Number(b.memories.length > 0) - Number(a.memories.length > 0) || a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
	return { repos };
}

/** `body` as `{ root, ops }`, or why it is not one. */
function parseEdit(body: unknown): { root: string; ops: RawOp[] } {
	if (!isObject(body) || typeof body.root !== "string" || !Array.isArray(body.ops)) throw new MemoryEditRefused("Expected { root, ops }.");
	const ops: RawOp[] = [];
	for (const op of body.ops) {
		if (!isObject(op) || (op.op !== "add" && op.op !== "update" && op.op !== "delete") || typeof op.slug !== "string") throw new MemoryEditRefused("Each op is { op: add | update | delete, slug, kind?, line?, body? }.");
		const { kind, line, body: text } = op;
		if (kind !== undefined && kind !== "decision" && kind !== "fact" && kind !== "lesson") throw new MemoryEditRefused(`${op.op} ${op.slug}: kind is decision, fact, or lesson.`);
		if ((line !== undefined && typeof line !== "string") || (text !== undefined && typeof text !== "string")) throw new MemoryEditRefused(`${op.op} ${op.slug}: line and body are text.`);
		ops.push({ op: op.op, slug: op.slug, kind, line, body: text });
	}
	return { root: body.root, ops };
}

/**
 * Applies the page's edit `body` to its repository's memory all or nothing, recorded as source `#dashboard`, and returns
 * the view after it; throws {@link MemoryEditRefused} for a `root` not among `roots` or ops the memory refuses.
 */
export function editProjectMemory(roots: readonly string[], body: unknown, today = localDay()): ProjectMemoryView {
	const { root, ops } = parseEdit(body);
	const place = roots.includes(root) ? placeOf(root) : null;
	if (!place) throw new MemoryEditRefused(`${root} is not one of the workspace repositories.`);
	const parsed = parseOps(ops);
	if (!parsed.ok) throw new MemoryEditRefused(parsed.reasons.join(" "));
	const plan = applyMemoryOps(place.root.commonDir, DASHBOARD_SOURCE, parsed.ops, today);
	if (!plan.ok) throw new MemoryEditRefused(plan.reasons.join(" "));
	return projectMemoryView(roots);
}
