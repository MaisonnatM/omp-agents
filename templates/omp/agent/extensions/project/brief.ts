// What the `project` extension reads of the dashboard's project list, and the brief a session in a project gets.
// The kit cannot import the dashboard's `src/`, so this keeps its own copy of the file's shape, the changes, the reducer
// that folds in the changes still waiting in the inbox, and the length limits of `src/shared/projects.ts`;
// `templates/omp/project-brief.test.ts` fails when they drift.
// The dashboard server alone writes the file, and parses every change before it does.

export interface Step {
	id: string;
	text: string;
	done: boolean;
	parentId?: string;
}

export interface LogEntry {
	at: string;
	sessionId?: string;
	text: string;
}

export interface Project {
	id: string;
	name: string;
	goal: string;
	steps: Step[];
	decisions: string[];
	log: LogEntry[];
	sessionIds: string[];
	archivedAt?: string;
}

/** A change a session leaves in the project inbox: any change the Projects page makes, on any project. */
export type ProjectChange =
	| { op: "create"; id: string; name: string; goal: string; at: string }
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
export const MAX_NAME = 200;
/** The characters a goal, a step, a decision, or a log line holds at most. */
export const MAX_TEXT = 4000;

/** The log lines a brief shows, the newest ones. */
export const BRIEF_LOG_LINES = 10;

const isProject = (value: unknown): value is Project => {
	const project = value as Partial<Record<keyof Project, unknown>> | null;
	return (
		typeof project === "object" &&
		project !== null &&
		typeof project.id === "string" &&
		typeof project.name === "string" &&
		typeof project.goal === "string" &&
		[project.steps, project.decisions, project.log, project.sessionIds].every(Array.isArray)
	);
};

/** The projects in what the project list file holds, less any malformed one; none for a missing or unreadable file. */
export function projectsIn(file: unknown): Project[] {
	const projects = (file as { projects?: unknown } | null)?.projects;
	return Array.isArray(projects) ? projects.filter(isProject) : [];
}

/** `project` after `change`, which names it, as the dashboard's reducer makes it. */
function editProject(project: Project, change: Exclude<ProjectChange, { op: "create" | "join" | "leave" }>): Project {
	switch (change.op) {
		case "rename":
			return { ...project, name: change.name };
		case "set-goal":
			return { ...project, goal: change.goal };
		case "archive":
			return { ...project, archivedAt: project.archivedAt ?? change.at };
		case "restore": {
			const { archivedAt: _, ...open } = project;
			return open;
		}
		case "add-step": {
			if (project.steps.some(step => step.id === change.stepId)) return project;
			const step: Step = { id: change.stepId, text: change.text, done: false, ...(change.parentId ? { parentId: change.parentId } : {}) };
			if (step.parentId === undefined) return { ...project, steps: [...project.steps, step] };
			const parent = project.steps.find(each => each.id === step.parentId);
			if (!parent || parent.parentId !== undefined) return project;
			const after = project.steps.findLastIndex(each => each.id === parent.id || each.parentId === parent.id);
			return { ...project, steps: project.steps.toSpliced(after + 1, 0, step) };
		}
		case "set-step":
			return { ...project, steps: project.steps.map(step => (step.id === change.stepId ? { ...step, done: change.done } : step)) };
		case "edit-step":
			return { ...project, steps: project.steps.map(step => (step.id === change.stepId ? { ...step, text: change.text } : step)) };
		case "remove-step":
			return { ...project, steps: project.steps.filter(step => step.id !== change.stepId && step.parentId !== change.stepId) };
		case "add-decision":
			return project.decisions.includes(change.text) ? project : { ...project, decisions: [...project.decisions, change.text] };
		case "remove-decision":
			return { ...project, decisions: project.decisions.filter(text => text !== change.text) };
		case "log": {
			const entry: LogEntry = { at: change.at, ...(change.sessionId ? { sessionId: change.sessionId } : {}), text: change.text };
			const same = (each: LogEntry) => each.at === entry.at && each.sessionId === entry.sessionId && each.text === entry.text;
			return project.log.some(same) ? project : { ...project, log: [...project.log, entry] };
		}
	}
}

/** `projects` after `change`; one the dashboard would refuse, such as an edit of a project it lacks, changes nothing. */
function applyChange(projects: Project[], change: ProjectChange): Project[] {
	switch (change.op) {
		case "create":
			return projects.some(project => project.id === change.id) ? projects : [...projects, { id: change.id, name: change.name, goal: change.goal, steps: [], decisions: [], log: [], sessionIds: [] }];
		case "join":
			if (!projects.some(project => project.id === change.projectId)) return projects;
			return projects.map(project => {
				if (project.id !== change.projectId) return { ...project, sessionIds: project.sessionIds.filter(id => id !== change.sessionId) };
				return project.sessionIds.includes(change.sessionId) ? project : { ...project, sessionIds: [...project.sessionIds, change.sessionId] };
			});
		case "leave":
			return projects.map(project => ({ ...project, sessionIds: project.sessionIds.filter(id => id !== change.sessionId) }));
		default:
			return projects.map(project => (project.id === change.projectId ? editProject(project, change) : project));
	}
}

/**
 * `projects` with the changes still `waiting` in the inbox, which the dashboard has not applied, folded over them in order,
 * so a session sees a project it just created or joined, and ticks a step it just added, while the dashboard is down.
 */
export const withWaiting = (projects: readonly Project[], waiting: readonly ProjectChange[]): Project[] => waiting.reduce(applyChange, [...projects]);

/** The open project session `sessionId` is in. */
export const projectOfSession = (projects: readonly Project[], sessionId: string): Project | null =>
	projects.find(project => project.archivedAt === undefined && project.sessionIds.includes(sessionId)) ?? null;

/** Why a change naming no project fails in a session in none: lists the open projects, so the agent can retry with one. */
export function noProjectError(projects: readonly Project[]): string {
	const open = projects.filter(project => project.archivedAt === undefined);
	if (open.length === 0) return "This session is in no open project, and no project is open; create one, or name an archived one with projectId, from project_list.";
	return `This session is in no open project; name one with projectId: ${open.map(project => `${project.name} (id ${project.id})`).join(", ")}.`;
}

/** The project `named` names, archived ones included: by id, else by its name, ignoring case; an error when none or several match. */
export function findProject(projects: readonly Project[], named: string): { project: Project } | { error: string } {
	const wanted = named.trim();
	const byId = projects.find(project => project.id === wanted);
	if (byId) return { project: byId };
	const byName = projects.filter(project => project.name.toLowerCase() === wanted.toLowerCase());
	if (byName.length === 1) return { project: byName[0]! };
	if (byName.length > 1) return { error: `Several projects are named "${wanted}"; name one by its id: ${byName.map(project => project.id).join(", ")}.` };
	return { error: `No project has the id or name "${wanted}"; project_list lists them.` };
}

/** Item `named` of `items`: its 1-based number in the brief, or its exact text. */
function findItem<T>(items: readonly T[], named: string, textOf: (item: T) => string): T | null {
	const wanted = named.trim();
	const index = /^\d+$/.test(wanted) ? Number(wanted) - 1 : -1;
	return items[index] ?? items.find(item => textOf(item) === wanted) ?? null;
}

/** Each step's number in the brief's plan: `2` for the second top-level step, `2.1` for the first sub-step under that one. */
export function stepNumbers(steps: readonly Step[]): Map<string, string> {
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

/** Step `named` of `project`: its number in the brief's plan, such as `2` or `2.1`, or its exact text. */
export function findStep(project: Project, named: string): Step | null {
	const wanted = named.trim().replace(/\.$/, "");
	const numbers = stepNumbers(project.steps);
	return project.steps.find(step => numbers.get(step.id) === wanted) ?? project.steps.find(step => step.text === named.trim()) ?? null;
}

/** Decision `named` of `project`: its 1-based number in the brief's decisions, or its exact text. */
export const findDecision = (project: Project, named: string): string | null => findItem(project.decisions, named, decision => decision);

/** Every project, open ones first, one line each: its name, id, whether it is archived, its progress, and its goal. */
export function listText(projects: readonly Project[], sessionId: string): string {
	if (projects.length === 0) return "There is no project yet; create one with project_update.";
	const ordered = [...projects.filter(project => project.archivedAt === undefined), ...projects.filter(project => project.archivedAt !== undefined)];
	return ordered
		.map(project => {
			const status = project.archivedAt === undefined ? "open" : "archived";
			const mine = project.sessionIds.includes(sessionId) ? ", this session's project" : "";
			const goal = project.goal.trim() ? `, goal: ${project.goal.trim()}` : "";
			return `- ${project.name} (id ${project.id}), ${status}${mine}, ${project.steps.filter(step => step.done).length} of ${project.steps.length} steps done${goal}`;
		})
		.join("\n");
}

/** The brief a session in `project` gets: its goal, its plan with what is done, its decisions, and its newest log lines. */
export function briefText(project: Project, sessionId: string): string {
	const lines = [`This session is part of the project "${project.name}" (id ${project.id}), which other sessions work on too.`];
	lines.push(`Goal: ${project.goal.trim() || "not set yet"}`);
	if (project.steps.length > 0) {
		const nested = project.steps.some(step => step.parentId !== undefined) ? "; a step numbered like 2.1 is a sub-step of step 2" : "";
		lines.push("", `Plan (${project.steps.filter(step => step.done).length} of ${project.steps.length} done${nested}):`);
		const numbers = stepNumbers(project.steps);
		lines.push(...project.steps.map(step => `${step.parentId === undefined ? "" : "   "}${numbers.get(step.id)}. [${step.done ? "x" : " "}] ${step.text}`));
	} else lines.push("", "Plan: no steps yet.");
	if (project.decisions.length > 0) lines.push("", "Decisions:", ...project.decisions.map((decision, index) => `${index + 1}. ${decision}`));
	const recent = project.log.slice(-BRIEF_LOG_LINES);
	if (recent.length > 0) {
		lines.push("", `Latest log, oldest first${project.log.length > recent.length ? ` (the last ${recent.length} of ${project.log.length})` : ""}:`);
		lines.push(...recent.map(entry => `- ${entry.at.slice(0, 10)} ${entry.sessionId === sessionId ? "this session" : entry.sessionId ? `session ${entry.sessionId}` : "the user"}: ${entry.text}`));
	}
	lines.push(
		"",
		"Work toward the goal. When you finish a step, tick it with project_update and log one line on what you did; record a decision the user settles with project_update too. Add a step only for work the plan is missing.",
	);
	return lines.join("\n");
}
