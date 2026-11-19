/**
 * The Memory page's project memory: each workspace repository's `refs/omp/memory`, read and changed with the
 * `project_memory` tool's own code, so an edit from the page is checked and recorded as the tool's are. See
 * docs/architecture/memory-page.md.
 */
import { MEMORY_KINDS, type MemoryKind, type RawOp } from "../templates/omp/agent/extensions/project-memory/contract";
import { applyMemoryOps, type Memory, memoryTip, parseOps, readMemory } from "../templates/omp/agent/extensions/project-memory/memory";
import { placeOf } from "../templates/omp/agent/extensions/project-memory/repo";
import { isObject } from "./json";
import { displayPath } from "./paths";
import { localDay } from "./shared/days";
import { DASHBOARD_SESSION, type ProjectMemoryEdit, type ProjectMemoryEntry, type ProjectMemoryRepo, type ProjectMemoryView } from "./shared/memory-page";

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

/** What `parseEdit` answers for a body that is not a {@link ProjectMemoryEdit}. */
export const EDIT_SHAPE = "Expected { root, ops }, each op { op: add | update | delete, slug, kind?: decision | fact | lesson, line?, body? }.";

const isText = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";

/** `body` as an edit when its fields have the edit's types, else `null`; whether its ops are valid is the memory's `parseOps` to say. */
export function parseEdit(body: unknown): ProjectMemoryEdit | null {
	if (!isObject(body) || typeof body.root !== "string" || !Array.isArray(body.ops)) return null;
	const ops: RawOp[] = [];
	for (const op of body.ops) {
		if (!isObject(op) || (op.op !== "add" && op.op !== "update" && op.op !== "delete") || typeof op.slug !== "string") return null;
		const { kind, line, body: text } = op;
		if ((kind !== undefined && !MEMORY_KINDS.includes(kind as MemoryKind)) || !isText(line) || !isText(text)) return null;
		ops.push({ op: op.op, slug: op.slug, kind: kind as MemoryKind | undefined, line, body: text });
	}
	return { root: body.root, ops };
}

/**
 * Applies `edit` to its repository's memory all or nothing, recorded as source `#dashboard`, and returns the view after
 * it; throws {@link MemoryEditRefused} for a `root` not among `roots` or ops the memory refuses.
 */
export function editProjectMemory(roots: readonly string[], { root, ops }: ProjectMemoryEdit, today = localDay()): ProjectMemoryView {
	const place = roots.includes(root) ? placeOf(root) : null;
	if (!place) throw new MemoryEditRefused(`${root} is not one of the workspace repositories.`);
	const parsed = parseOps(ops);
	if (!parsed.ok) throw new MemoryEditRefused(parsed.reasons.join(" "));
	const plan = applyMemoryOps(place.root.commonDir, DASHBOARD_SESSION, parsed.ops, today);
	if (!plan.ok) throw new MemoryEditRefused(plan.reasons.join(" "));
	return projectMemoryView(roots);
}
