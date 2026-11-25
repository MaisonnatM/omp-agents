/**
 * Projects: named efforts that span sessions and workspaces, each with a goal, a checklist plan, decisions, and a dated
 * log, which the server keeps in `project-list.json` and every session in a project reads at its start. The starter kit's
 * `templates/omp/agent/extensions/project.ts` reads the same file but cannot import `src/`, so it keeps its own copy of
 * the file's shape in `project/brief.ts`: change it with this one. See docs/architecture/projects.md.
 */
import { arrayOf, decoder, fields, type Guard, isBoolean, isNonEmpty, isObject, isString, optional, type Parsed, type Shape, tagged } from "../json";

/** A step of a plan, which keeps each sub-step right after its parent's earlier ones, so its order is the order the plan shows. */
export interface ProjectStep {
	id: string;
	text: string;
	done: boolean;
	/** The top-level step it sits under; a sub-step has none of its own, so a plan nests two levels at most. */
	parentId?: string;
}

/** One dated line of a project's log, signed with the session that wrote it; one the page wrote has no session. */
export interface ProjectLogEntry {
	at: string;
	sessionId?: string;
	text: string;
}

export interface Project {
	id: string;
	name: string;
	goal: string;
	steps: ProjectStep[];
	decisions: string[];
	/** Oldest first, so a new line is appended. */
	log: ProjectLogEntry[];
	/** The sessions in the project, in the order they joined; a session is in one project at most. */
	sessionIds: string[];
	createdAt: string;
	/** The Workspace it was made in, from a Board's Projects tab, which then lists it; absent for one made on the Projects page. */
	workspace?: string;
	/** When the project was archived, which drops it from the roster and from the briefs; absent while it is open. */
	archivedAt?: string;
}

export interface ProjectList {
	projects: Project[];
}

export const EMPTY_PROJECTS: ProjectList = { projects: [] };

/**
 * A change to the projects. Each is idempotent: a step, a project, or a log line whose id or content is already there,
 * a step set to the state it is in, and a join of a session already in that project change nothing, so a change sent
 * twice, as a retried inbox file or a page's replay, lands once.
 */
export type ProjectChange =
	| { op: "create"; id: string; name: string; goal: string; at: string; workspace?: string }
	| { op: "rename"; projectId: string; name: string }
	| { op: "set-goal"; projectId: string; goal: string }
	| { op: "archive"; projectId: string; at: string }
	| { op: "restore"; projectId: string }
	| { op: "add-step"; projectId: string; stepId: string; text: string; parentId?: string }
	| { op: "set-step"; projectId: string; stepId: string; done: boolean }
	| { op: "edit-step"; projectId: string; stepId: string; text: string }
	| { op: "remove-step"; projectId: string; stepId: string }
	| { op: "add-decision"; projectId: string; text: string }
	| { op: "remove-decision"; projectId: string; text: string }
	| { op: "log"; projectId: string; at: string; sessionId?: string; text: string }
	| { op: "join"; projectId: string; sessionId: string }
	| { op: "leave"; sessionId: string };

/** The characters a project's name holds at most. */
export const MAX_PROJECT_NAME = 200;
/** The characters a goal, a step, a decision, or a log line holds at most. */
export const MAX_PROJECT_TEXT = 4000;

/** A string of at most `max` characters, and one with more than white space unless `blank` allows it. */
const textUpTo =
	(max: number, blank = false): Guard<string> =>
	(value): value is string =>
		isString(value) && (blank || isNonEmpty(value)) && value.length <= max;
const isName = textUpTo(MAX_PROJECT_NAME);
const isLine = textUpTo(MAX_PROJECT_TEXT);
const isGoal = textUpTo(MAX_PROJECT_TEXT, true);

const isStep: Guard<ProjectStep> = fields<ProjectStep>({ id: isNonEmpty, text: isString, done: isBoolean, parentId: optional(isNonEmpty) });
const isLogEntry: Guard<ProjectLogEntry> = fields<ProjectLogEntry>({ at: isNonEmpty, sessionId: optional(isNonEmpty), text: isString });
const isProject: Guard<Project> = fields<Project>({
	id: isNonEmpty,
	name: isNonEmpty,
	goal: isString,
	steps: arrayOf(isStep),
	decisions: arrayOf(isString),
	log: arrayOf(isLogEntry),
	sessionIds: arrayOf(isNonEmpty),
	createdAt: isNonEmpty,
	archivedAt: optional(isNonEmpty),
	workspace: optional(isNonEmpty),
});

/** What `project-list.json` holds, or `null` for anything else. */
export const parseProjectList = decoder<ProjectList>(fields<ProjectList>({ projects: arrayOf(isProject) }));

/** Each op's fields and the guard of each, which both checks a change and names the fields it keeps. */
const CHANGE_SHAPES: { [Op in ProjectChange["op"]]: Shape<Omit<Extract<ProjectChange, { op: Op }>, "op">> } = {
	create: { id: isNonEmpty, name: isName, goal: isGoal, at: isNonEmpty, workspace: optional(isNonEmpty) },
	rename: { projectId: isNonEmpty, name: isName },
	"set-goal": { projectId: isNonEmpty, goal: isGoal },
	archive: { projectId: isNonEmpty, at: isNonEmpty },
	restore: { projectId: isNonEmpty },
	"add-step": { projectId: isNonEmpty, stepId: isNonEmpty, text: isLine, parentId: optional(isNonEmpty) },
	"set-step": { projectId: isNonEmpty, stepId: isNonEmpty, done: isBoolean },
	"edit-step": { projectId: isNonEmpty, stepId: isNonEmpty, text: isLine },
	"remove-step": { projectId: isNonEmpty, stepId: isNonEmpty },
	"add-decision": { projectId: isNonEmpty, text: isLine },
	"remove-decision": { projectId: isNonEmpty, text: isLine },
	log: { projectId: isNonEmpty, at: isNonEmpty, sessionId: optional(isNonEmpty), text: isLine },
	join: { projectId: isNonEmpty, sessionId: isNonEmpty },
	leave: { sessionId: isNonEmpty },
};

const isChange = tagged<ProjectChange, "op">("op", CHANGE_SHAPES);

/** A change as a page or an agent sent it, with only the fields its `op` names, its strings trimmed, or why it is none. */
export function parseProjectChange(value: unknown): Parsed<ProjectChange, { error: string }> {
	if (!isObject(value) || typeof value.op !== "string") return { error: "A project change needs an op." };
	if (!isChange(value))
		return { error: `A project ${value.op} change is missing a field, has one of the wrong type, or one too long: a name holds at most ${MAX_PROJECT_NAME} characters, and a goal or a line at most ${MAX_PROJECT_TEXT}.` };
	const kept = Object.keys(CHANGE_SHAPES[value.op]).flatMap(key => {
		const field = (value as Record<string, unknown>)[key];
		return field === undefined ? [] : [[key, typeof field === "string" ? field.trim() : field]];
	});
	return { ok: { op: value.op, ...Object.fromEntries(kept) } as ProjectChange };
}

/** The projects the roster and the briefs show: those not archived, oldest first. */
export const openProjects = (list: ProjectList): Project[] => list.projects.filter(project => project.archivedAt === undefined);

/** `item` with `key` set to `value`, the same object when it holds that value already. */
const set = <T, K extends keyof T>(item: T, key: K, value: T[K]): T => (item[key] === value ? item : { ...item, [key]: value });

type Edit = (project: Project) => Project | { error: string };

function editProject(list: ProjectList, projectId: string, edit: Edit): Parsed<ProjectList, { error: string }> {
	const index = list.projects.findIndex(project => project.id === projectId);
	const project = list.projects[index];
	if (!project) return { error: `No project has id ${projectId}.` };
	const edited = edit(project);
	if ("error" in edited) return edited;
	if (edited === project) return { ok: list };
	return { ok: { projects: list.projects.with(index, edited) } };
}

function editStep(project: Project, stepId: string, edit: (step: ProjectStep) => ProjectStep): Project | { error: string } {
	const index = project.steps.findIndex(step => step.id === stepId);
	const step = project.steps[index];
	if (!step) return { error: `Project ${project.name} has no step ${stepId}.` };
	const edited = edit(step);
	return edited === step ? project : { ...project, steps: project.steps.with(index, edited) };
}

/** `steps` with `step` added: a top-level step at the end, a sub-step after its parent's last one; or why not, when its parent is missing or a sub-step itself. */
function withStep(steps: readonly ProjectStep[], step: ProjectStep): ProjectStep[] | { error: string } {
	if (step.parentId === undefined) return [...steps, step];
	const parent = steps.find(each => each.id === step.parentId);
	if (!parent) return { error: `No step has id ${step.parentId} to hold a sub-step.` };
	if (parent.parentId !== undefined) return { error: "A sub-step holds no steps of its own: a plan nests two levels at most." };
	const after = steps.findLastIndex(each => each.id === parent.id || each.parentId === parent.id);
	return steps.toSpliced(after + 1, 0, step);
}

/** Each step's number in the plan: `2` for its second top-level step, `2.1` for the first sub-step under that one. */
export function stepNumbers(steps: readonly ProjectStep[]): Map<string, string> {
	const numbers = new Map<string, string>();
	const subSteps = new Map<string, number>();
	let top = 0;
	for (const step of steps) {
		if (step.parentId === undefined) {
			top += 1;
			numbers.set(step.id, String(top));
			continue;
		}
		const count = (subSteps.get(step.parentId) ?? 0) + 1;
		subSteps.set(step.parentId, count);
		numbers.set(step.id, `${numbers.get(step.parentId)}.${count}`);
	}
	return numbers;
}

/** `list` after `change`, the same object when the change changes nothing, or why the list refuses it. */
export function applyProjectChange(list: ProjectList, change: ProjectChange): Parsed<ProjectList, { error: string }> {
	switch (change.op) {
		case "create": {
			if (list.projects.some(project => project.id === change.id)) return { ok: list };
			const project: Project = { id: change.id, name: change.name, goal: change.goal, steps: [], decisions: [], log: [], sessionIds: [], createdAt: change.at, ...(change.workspace ? { workspace: change.workspace } : {}) };
			return { ok: { projects: [...list.projects, project] } };
		}
		case "rename":
			return editProject(list, change.projectId, project => set(project, "name", change.name));
		case "set-goal":
			return editProject(list, change.projectId, project => set(project, "goal", change.goal));
		case "archive":
			return editProject(list, change.projectId, project => set(project, "archivedAt", project.archivedAt ?? change.at));
		case "restore":
			return editProject(list, change.projectId, project => {
				if (project.archivedAt === undefined) return project;
				const { archivedAt: _, ...open } = project;
				return open;
			});
		case "add-step":
			return editProject(list, change.projectId, project => {
				if (project.steps.some(step => step.id === change.stepId)) return project;
				const steps = withStep(project.steps, { id: change.stepId, text: change.text, done: false, ...(change.parentId ? { parentId: change.parentId } : {}) });
				return "error" in steps ? steps : { ...project, steps };
			});
		case "set-step":
			return editProject(list, change.projectId, project => editStep(project, change.stepId, step => set(step, "done", change.done)));
		case "edit-step":
			return editProject(list, change.projectId, project => editStep(project, change.stepId, step => set(step, "text", change.text)));
		case "remove-step":
			return editProject(list, change.projectId, project =>
				project.steps.some(step => step.id === change.stepId) ? { ...project, steps: project.steps.filter(step => step.id !== change.stepId && step.parentId !== change.stepId) } : project,
			);
		case "add-decision":
			return editProject(list, change.projectId, project => (project.decisions.includes(change.text) ? project : { ...project, decisions: [...project.decisions, change.text] }));
		case "remove-decision":
			return editProject(list, change.projectId, project =>
				project.decisions.includes(change.text) ? { ...project, decisions: project.decisions.filter(text => text !== change.text) } : project,
			);
		case "log": {
			const entry: ProjectLogEntry = { at: change.at, ...(change.sessionId ? { sessionId: change.sessionId } : {}), text: change.text };
			const same = (each: ProjectLogEntry) => each.at === entry.at && each.text === entry.text && each.sessionId === entry.sessionId;
			return editProject(list, change.projectId, project => (project.log.some(same) ? project : { ...project, log: [...project.log, entry] }));
		}
		case "join": {
			const target = list.projects.find(project => project.id === change.projectId);
			if (!target) return { error: `No project has id ${change.projectId}.` };
			if (target.sessionIds.includes(change.sessionId)) return { ok: list };
			const left = leave(list, change.sessionId);
			return editProject(left, change.projectId, project => ({ ...project, sessionIds: [...project.sessionIds, change.sessionId] }));
		}
		case "leave":
			return { ok: leave(list, change.sessionId) };
	}
}

/** `list` with session `sessionId` in no project, the same object when it was in none. */
function leave(list: ProjectList, sessionId: string): ProjectList {
	if (!list.projects.some(project => project.sessionIds.includes(sessionId))) return list;
	return { projects: list.projects.map(project => (project.sessionIds.includes(sessionId) ? { ...project, sessionIds: project.sessionIds.filter(id => id !== sessionId) } : project)) };
}
