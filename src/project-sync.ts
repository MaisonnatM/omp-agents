/**
 * Settings sync's Projects item: each project as every machine keeps it, with its name, goal, decisions, archive time,
 * and plan. A project's sessions and its log name this machine's sessions, so they stay here.
 */
import { arrayOf, decoder, fields, type Guard, isBoolean, isNonEmpty, isString, optional } from "./json";
import type { Project, ProjectList, ProjectStep } from "./shared/projects";

export interface CarriedProject {
	id: string;
	name: string;
	goal: string;
	decisions: string[];
	createdAt: string;
	archivedAt?: string;
	steps: ProjectStep[];
}

const isCarriedProject: Guard<CarriedProject> = fields<CarriedProject>({
	id: isNonEmpty,
	name: isNonEmpty,
	goal: isString,
	decisions: arrayOf(isString),
	createdAt: isNonEmpty,
	archivedAt: optional(isNonEmpty),
	steps: arrayOf(fields<ProjectStep>({ id: isNonEmpty, text: isString, done: isBoolean, parentId: optional(isNonEmpty) })),
});

const decodeProjects = decoder<CarriedProject[]>(arrayOf(isCarriedProject));

/** The projects `value` holds, or `null` when it holds anything else, repeats a project or a step id, or nests a step under one that is no top-level step of its project. */
export function parseProjects(value: unknown): CarriedProject[] | null {
	const projects = decodeProjects(value);
	if (!projects) return null;
	if (new Set(projects.map(project => project.id)).size !== projects.length) return null;
	for (const { steps } of projects) {
		if (new Set(steps.map(step => step.id)).size !== steps.length) return null;
		const topSteps = new Set(steps.filter(step => step.parentId === undefined).map(step => step.id));
		if (steps.some(step => step.parentId !== undefined && !topSteps.has(step.parentId))) return null;
	}
	return projects;
}

/** The projects of `list` as sync carries them, in the list's order. */
export function portableProjects(list: ProjectList): CarriedProject[] {
	return list.projects.map(({ id, name, goal, decisions, createdAt, archivedAt, steps }) => ({
		id,
		name,
		goal,
		decisions,
		createdAt,
		...(archivedAt === undefined ? {} : { archivedAt }),
		steps,
	}));
}

/** `list` with exactly `projects` as its projects, each keeping the sessions and the log this machine had in it; the same object when nothing changes. */
export function withProjects(list: ProjectList, projects: readonly CarriedProject[]): ProjectList {
	const here = new Map(list.projects.map(project => [project.id, project]));
	const next: ProjectList = {
		projects: projects.map((carried): Project => {
			const local = here.get(carried.id);
			return { ...carried, log: local?.log ?? [], sessionIds: local?.sessionIds ?? [] };
		}),
	};
	return Bun.deepEquals(next, list) ? list : next;
}
