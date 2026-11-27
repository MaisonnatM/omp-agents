/**
 * The copies of the routines marked "Add to every new Workspace", the templates: the server that runs routines copies a
 * template into every Workspace when it is turned on, and every template into a Workspace it has not seen before. A copy
 * follows its template until it is detached. What it saw is kept on this computer only, so a copy you delete is not
 * copied again, and Settings sync never carries it.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { JsonFile } from "../fs";
import { fields, isTexts, optional } from "../json";
import type { Routine, RoutineSpec } from "../routines";
import { inTempDir } from "../shared/workspaces";

/** The Workspaces the copies were made for, the templates already copied into each of them, and whether the copies made before copies followed their template were linked. */
export interface CopiesSeen {
	workspaces: string[];
	templates: string[];
	linked?: true;
}

const isCopiesSeen = fields<CopiesSeen>({ workspaces: isTexts, templates: isTexts, linked: optional((value): value is true => value === true) });

/** Whether Workspace `dir` takes copies: a repository's main checkout, whose `.git` is a directory, outside the temp roots. */
export function takesCopies(dir: string): boolean {
	if (inTempDir(dir)) return false;
	try {
		return statSync(join(dir, ".git")).isDirectory();
	} catch {
		return false;
	}
}

/** `template` copied into `workspace`: its own routine with a fresh id, enabled or not as the template is, that follows the template. */
function copyOf(template: Routine, workspace: string, id: string): RoutineSpec {
	const { name, schedules, triggers, task, enabled, launch } = template;
	const copy: RoutineSpec = { id, workspace, name, schedules, triggers, task, enabled, copyOf: template.id, linked: true };
	if (launch) copy.launch = launch;
	return copy;
}

/**
 * The copies to save among `routines` for the `eligible` Workspaces, the older copies to link, and what is seen after: a
 * template not seen yet goes to every eligible Workspace, and a Workspace not seen yet gets every template, each only
 * where the Workspace does not have it. With nothing seen yet, it copies nothing and sees what is there, so the first run
 * adds no copy. Once, it asks to link every copy made before copies followed their template; the save keeps the link
 * only on the ones still the same as their template, so a copy you changed stays your own.
 */
export function copiesFor(
	routines: readonly Routine[],
	eligible: readonly string[],
	seen: CopiesSeen | null,
	newId: () => string,
): { copies: RoutineSpec[]; links: RoutineSpec[]; seen: CopiesSeen } {
	const templates = routines.filter(routine => routine.everyWorkspace);
	if (seen === null) return { copies: [], links: [], seen: { workspaces: [...new Set(eligible)], templates: templates.map(template => template.id), linked: true } };
	const copies: RoutineSpec[] = [];
	for (const workspace of new Set(eligible))
		for (const template of templates) {
			const fresh = !seen.workspaces.includes(workspace) || !seen.templates.includes(template.id);
			// A Workspace has a template when it is the template's own, or one of its routines was copied from it.
			const has = template.workspace === workspace || routines.some(routine => routine.workspace === workspace && routine.copyOf === template.id);
			if (fresh && !has) copies.push(copyOf(template, workspace, newId()));
		}
	const links = seen.linked
		? []
		: routines
				.filter(routine => routine.copyOf !== undefined && !routine.linked)
				.map(({ runs: _runs, createdAt: _createdAt, scheduledAt: _scheduledAt, machine: _machine, ...spec }) => ({ ...spec, linked: true as const }));
	// Only the templates still on stay seen, so one turned off and on again is copied again.
	return { copies, links, seen: { workspaces: [...new Set([...seen.workspaces, ...eligible])], templates: templates.map(template => template.id), linked: true } };
}

export interface RoutineCopiesDeps {
	/** Where what was seen is kept. */
	path: string;
	routines(): readonly Routine[];
	/** The Workspaces that take copies: the ones the dashboard shows that pass {@link takesCopies}. */
	eligible(): string[];
	/** Saves a copy, new or linked, and tells every page. */
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

	/** Saves the copies due now and the links, then what was seen, so a crash between the two repeats no copy: the Workspace then has it. */
	check(): void {
		const before = this.#file.load();
		const eligible = this.#deps.eligible();
		const { copies, links, seen } = copiesFor(this.#deps.routines(), eligible, before, this.#deps.newId ?? randomUUID);
		for (const copy of [...copies, ...links]) this.#deps.save(copy);
		if (JSON.stringify(seen) !== JSON.stringify(before)) this.#file.save(seen);
	}
}
