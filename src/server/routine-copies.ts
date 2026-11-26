/**
 * The copies of the routines marked "Add to every new Workspace", the templates: the server that runs routines copies a
 * template into every Workspace when it is turned on, and every template into a Workspace it has not seen before. What
 * it saw is kept on this computer only, so a copy you delete is not copied again, and Settings sync never carries it.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { JsonFile } from "../fs";
import { fields, isTexts } from "../json";
import type { Routine, RoutineSpec } from "../routines";
import { inTempDir } from "../shared/workspaces";

/** The Workspaces the copies were made for, and the templates already copied into each of them. */
export interface CopiesSeen {
	workspaces: string[];
	templates: string[];
}

const isCopiesSeen = fields<CopiesSeen>({ workspaces: isTexts, templates: isTexts });

/** Whether Workspace `dir` takes copies: a repository's main checkout, whose `.git` is a directory, outside the temp roots. */
export function takesCopies(dir: string): boolean {
	if (inTempDir(dir)) return false;
	try {
		return statSync(join(dir, ".git")).isDirectory();
	} catch {
		return false;
	}
}

/** `template` copied into `workspace`: its own routine with a fresh id, enabled or not as the template is. */
function copyOf(template: Routine, workspace: string, id: string): RoutineSpec {
	const { name, schedules, triggers, task, enabled, launch } = template;
	const copy: RoutineSpec = { id, workspace, name, schedules, triggers, task, enabled, copyOf: template.id };
	if (launch) copy.launch = launch;
	return copy;
}

/**
 * The copies to save among `routines` for the `eligible` Workspaces, and what is seen after: a template not seen yet goes
 * to every eligible Workspace, and a Workspace not seen yet gets every template, each only where the Workspace does not
 * have it. With nothing seen yet, it copies nothing and sees what is there, so the first run adds no copy.
 */
export function copiesFor(routines: readonly Routine[], eligible: readonly string[], seen: CopiesSeen | null, newId: () => string): { copies: RoutineSpec[]; seen: CopiesSeen } {
	const templates = routines.filter(routine => routine.everyWorkspace);
	if (seen === null) return { copies: [], seen: { workspaces: [...new Set(eligible)], templates: templates.map(template => template.id) } };
	const copies: RoutineSpec[] = [];
	for (const workspace of new Set(eligible))
		for (const template of templates) {
			const fresh = !seen.workspaces.includes(workspace) || !seen.templates.includes(template.id);
			// A Workspace has a template when it is the template's own, or one of its routines was copied from it.
			const has = template.workspace === workspace || routines.some(routine => routine.workspace === workspace && routine.copyOf === template.id);
			if (fresh && !has) copies.push(copyOf(template, workspace, newId()));
		}
	// Only the templates still on stay seen, so one turned off and on again is copied again.
	return { copies, seen: { workspaces: [...new Set([...seen.workspaces, ...eligible])], templates: templates.map(template => template.id) } };
}

export interface RoutineCopiesDeps {
	/** Where what was seen is kept. */
	path: string;
	routines(): readonly Routine[];
	/** The Workspaces that take copies: the ones the dashboard shows that pass {@link takesCopies}. */
	eligible(): string[];
	/** Saves a copy as a new routine and tells every page. */
	save(routine: RoutineSpec): void;
	newId?: () => string;
}

/** Makes the copies {@link copiesFor} names; only the server that runs routines calls {@link check}, which a second call repeats as a no-op. */
export class RoutineCopies {
	readonly #deps: RoutineCopiesDeps;
	readonly #file: JsonFile<CopiesSeen>;

	constructor(deps: RoutineCopiesDeps) {
		this.#deps = deps;
		this.#file = new JsonFile<CopiesSeen>(deps.path, { parse: value => (isCopiesSeen(value) ? value : null), holds: "the Workspaces and templates routines were copied for", onInvalid: "ignore" });
	}

	/** Saves the copies due now, then what was seen, so a crash between the two repeats no copy: the Workspace then has it. */
	check(): void {
		const before = this.#file.load();
		const eligible = this.#deps.eligible();
		const { copies, seen } = copiesFor(this.#deps.routines(), eligible, before, this.#deps.newId ?? randomUUID);
		for (const copy of copies) this.#deps.save(copy);
		if (JSON.stringify(seen) !== JSON.stringify(before)) this.#file.save(seen);
	}
}
