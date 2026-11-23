/**
 * Moves the projects an older version kept in `project-list.json` onto the Board, once: each project becomes a project
 * channel, its plan's steps task threads, and its log the messages of a thread named "Log". The old file is renamed
 * `project-list.json.migrated` once the Board saved them, so the move runs at most once.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import type { ReducerFile } from "../fs";
import { arrayOf, decoder, fields, type Guard, isBoolean, isNonEmpty, isString, optional, parseJson } from "../json";
import { type BoardChange, type BoardState, type Channel, channelName, type Message, sessionMemberId, type Thread } from "../shared/board";

/** A project as `project-list.json` kept it. */
export interface LegacyProject {
	id: string;
	name: string;
	goal: string;
	steps: { id: string; text: string; done: boolean; parentId?: string }[];
	decisions: string[];
	log: { at: string; sessionId?: string; text: string }[];
	sessionIds: string[];
	createdAt: string;
	archivedAt?: string;
}

const isProject: Guard<LegacyProject> = fields<LegacyProject>({
	id: isNonEmpty,
	name: isNonEmpty,
	goal: isString,
	steps: arrayOf(fields<LegacyProject["steps"][number]>({ id: isNonEmpty, text: isString, done: isBoolean, parentId: optional(isNonEmpty) })),
	decisions: arrayOf(isString),
	log: arrayOf(fields<LegacyProject["log"][number]>({ at: isNonEmpty, sessionId: optional(isNonEmpty), text: isString })),
	sessionIds: arrayOf(isNonEmpty),
	createdAt: isNonEmpty,
	archivedAt: optional(isNonEmpty),
});

/** What `project-list.json` holds, or `null` for anything else. */
export const parseLegacyProjects = decoder<{ projects: LegacyProject[] }>(fields<{ projects: LegacyProject[] }>({ projects: arrayOf(isProject) }));

export const projectChannelId = (projectId: string): string => `c-project-${projectId}`;
const stepThreadId = (projectId: string, stepId: string): string => `t-project-${projectId}-${stepId}`;

/** `state` with each of `projects` as a project channel; a project whose channel is there already is skipped. `now` stands in for a time that does not parse. */
export function foldProjects(state: BoardState, projects: readonly LegacyProject[], now: number): BoardState {
	const ms = (iso: string, fallback: number) => {
		const at = Date.parse(iso);
		return Number.isNaN(at) ? fallback : at;
	};
	let next = state;
	for (const project of projects) {
		const id = projectChannelId(project.id);
		if (next.channels.some(channel => channel.id === id)) continue;
		const createdAt = ms(project.createdAt, now);
		const channel: Channel = {
			id,
			name: channelName(next, project.name),
			about: "",
			project: {
				goal: project.goal,
				decisions: project.decisions,
				sessionIds: project.sessionIds,
				createdAt,
				...(project.archivedAt === undefined ? {} : { archivedAt: ms(project.archivedAt, now) }),
			},
		};
		const steps: Thread[] = project.steps.map(step => ({
			id: stepThreadId(project.id, step.id),
			channel: id,
			title: step.text,
			task: step.done ? "done" : "open",
			lease: null,
			createdAt,
			...(step.parentId === undefined ? {} : { parent: stepThreadId(project.id, step.parentId) }),
		}));
		const logThread = `t-project-${project.id}-log`;
		const log: Message[] = project.log.map((entry, index) => ({
			id: `m-project-${project.id}-log-${index}`,
			thread: logThread,
			author: entry.sessionId ? sessionMemberId(entry.sessionId) : next.me,
			at: ms(entry.at, createdAt),
			text: entry.text,
		}));
		next = {
			...next,
			channels: [...next.channels, channel],
			threads: [...next.threads, ...steps, ...(log.length === 0 ? [] : [{ id: logThread, channel: id, title: "Log", task: null, lease: null, createdAt }])],
			messages: [...next.messages, ...log],
		};
	}
	return next;
}

/** Folds the projects of `path`, an older `project-list.json`, into `board`, then renames that file `<path>.migrated`; a file that holds no project list stays where it is. */
export function migrateProjectList(board: ReducerFile<BoardState, [BoardChange]>, path: string, now: number): void {
	if (!existsSync(path)) return;
	const list = parseLegacyProjects(parseJson(readFileSync(path, "utf8")));
	if (!list) {
		console.warn(`${path} holds no project list, so its projects were not moved to the Board.`);
		return;
	}
	board.update(state => foldProjects(state, list.projects, now));
	if (board.flush()) renameSync(path, `${path}.migrated`);
}
