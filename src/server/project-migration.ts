/**
 * Moves the projects an older version kept on its Board back into `project-list.json`, once: each project channel of
 * `board.json` becomes a project, its task threads the steps of its plan, and its messages its log. The Board is gone,
 * so `board.json` is renamed `board.json.removed` once the projects are saved, and the move runs at most once.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import type { ReducerFile } from "../fs";
import { arrayOf, decoder, fields, type Guard, isNonEmpty, isNumber, isString, nullable, oneOf, optional, parseJson } from "../json";
import type { Project, ProjectChange, ProjectList, ProjectStep } from "../shared/projects";

/** What a project channel of `board.json` carried. */
interface BoardProject {
	goal: string;
	decisions: string[];
	sessionIds: string[];
	createdAt: number;
	archivedAt?: number;
}

/** The parts of `board.json` the projects were made of; the rest of the Board is dropped. */
export interface OldBoard {
	channels: { id: string; name: string; project?: BoardProject }[];
	threads: { id: string; channel: string; title: string; task: "open" | "claimed" | "review" | "done" | null; createdAt: number; parent?: string }[];
	messages: { thread: string; author: string; at: number; text: string }[];
	extraMembers?: { id: string; sessionId?: string }[];
}

const isBoardProject: Guard<BoardProject> = fields<BoardProject>({ goal: isString, decisions: arrayOf(isString), sessionIds: arrayOf(isNonEmpty), createdAt: isNumber, archivedAt: optional(isNumber) });

/** What `board.json` holds, or `null` for anything else. */
export const parseOldBoard = decoder<OldBoard>(
	fields<OldBoard>({
		channels: arrayOf(fields<OldBoard["channels"][number]>({ id: isNonEmpty, name: isNonEmpty, project: optional(isBoardProject) })),
		threads: arrayOf(
			fields<OldBoard["threads"][number]>({ id: isNonEmpty, channel: isNonEmpty, title: isString, task: nullable(oneOf(["open", "claimed", "review", "done"] as const)), createdAt: isNumber, parent: optional(isNonEmpty) }),
		),
		messages: arrayOf(fields<OldBoard["messages"][number]>({ thread: isNonEmpty, author: isNonEmpty, at: isNumber, text: isString })),
		extraMembers: optional(arrayOf(fields<NonNullable<OldBoard["extraMembers"]>[number]>({ id: isNonEmpty, sessionId: optional(isNonEmpty) }))),
	}),
);

/** The project id an older migration gave its channel, `c-project-<id>`, taken back; any other channel id stays. */
const projectId = (channelId: string): string => channelId.replace(/^c-project-(?=.)/, "");

/** The thread title an older migration gave a project's log. */
const LOG_THREAD = "Log";

/** `channel`'s plan: its task threads, each top-level step followed by its sub-steps; a sub-step whose parent is no top-level step becomes one. */
function stepsOf(board: OldBoard, channelId: string, id: string): ProjectStep[] {
	const tasks = board.threads.filter(thread => thread.channel === channelId && thread.task !== null);
	const top = new Set(tasks.filter(thread => thread.parent === undefined).map(thread => thread.id));
	const prefix = `t-project-${id}-`;
	const stepId = (threadId: string) => (threadId.startsWith(prefix) && threadId.length > prefix.length ? threadId.slice(prefix.length) : threadId);
	const step = (thread: (typeof tasks)[number], parent?: string): ProjectStep => ({ id: stepId(thread.id), text: thread.title, done: thread.task === "done", ...(parent === undefined ? {} : { parentId: stepId(parent) }) });
	const isSub = (thread: (typeof tasks)[number]) => thread.parent !== undefined && top.has(thread.parent);
	return tasks.filter(thread => !isSub(thread)).flatMap(thread => [step(thread), ...tasks.filter(sub => isSub(sub) && sub.parent === thread.id).map(sub => step(sub, thread.id))]);
}

/** The projects of `board` not in `list` already, appended to it; the same object when there are none. */
export function foldBoardProjects(list: ProjectList, board: OldBoard): ProjectList {
	const known = new Set(list.projects.map(project => project.id));
	const iso = (ms: number) => new Date(ms).toISOString();
	const sessionOf = (author: string): string | undefined => (author.startsWith("s-") ? author.slice(2) : board.extraMembers?.find(member => member.id === author)?.sessionId);
	const added: Project[] = [];
	for (const channel of board.channels) {
		const id = projectId(channel.id);
		if (!channel.project || known.has(id)) continue;
		known.add(id);
		const threads = new Map(board.threads.filter(thread => thread.channel === channel.id).map(thread => [thread.id, thread]));
		const log = board.messages
			.filter(message => threads.has(message.thread))
			.toSorted((a, b) => a.at - b.at)
			.map(message => {
				const title = threads.get(message.thread)?.title ?? LOG_THREAD;
				const sessionId = sessionOf(message.author);
				return { at: iso(message.at), ...(sessionId ? { sessionId } : {}), text: title === LOG_THREAD ? message.text : `${title}: ${message.text}` };
			});
		const { goal, decisions, sessionIds, createdAt, archivedAt } = channel.project;
		added.push({
			id,
			name: channel.name,
			goal,
			steps: stepsOf(board, channel.id, id),
			decisions,
			log,
			sessionIds,
			createdAt: iso(createdAt),
			...(archivedAt === undefined ? {} : { archivedAt: iso(archivedAt) }),
		});
	}
	return added.length === 0 ? list : { projects: [...list.projects, ...added] };
}

/** Folds the projects of `boardPath`, an older `board.json`, into `projects`, then renames that file `<boardPath>.removed`; a file that holds no board stays where it is. */
export function migrateBoardProjects(projects: ReducerFile<ProjectList, [ProjectChange]>, boardPath: string): void {
	if (!existsSync(boardPath)) return;
	const board = parseOldBoard(parseJson(readFileSync(boardPath, "utf8")));
	if (!board) {
		console.warn(`${boardPath} holds no board, so its projects were not moved to the project list.`);
		return;
	}
	projects.update(list => foldBoardProjects(list, board));
	if (projects.flush()) renameSync(boardPath, `${boardPath}.removed`);
}
