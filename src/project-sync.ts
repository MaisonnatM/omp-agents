/**
 * Settings sync's Projects item: each Board project as every machine keeps it, with its name, about, goal, decisions,
 * archive time, and plan. A project's sessions, a step's lease, and the project's messages name this machine's
 * sessions, so they stay here.
 */
import { arrayOf, decoder, fields, type Guard, isNonEmpty, isNumber, isString, oneOf, optional } from "./json";
import { type BoardState, type Channel, type ChannelProject, channelName, isProjectChannel, type TaskState, type Thread } from "./shared/board";

/** A plan step: a task thread of a project channel, without its lease. */
export interface CarriedStep {
	id: string;
	title: string;
	task: TaskState;
	createdAt: number;
	parent?: string;
}

export interface CarriedProject {
	id: string;
	name: string;
	about: string;
	goal: string;
	decisions: string[];
	createdAt: number;
	archivedAt?: number;
	steps: CarriedStep[];
}

const isCarriedStep: Guard<CarriedStep> = fields<CarriedStep>({
	id: isNonEmpty,
	title: isString,
	task: oneOf(["open", "claimed", "review", "done"] as const),
	createdAt: isNumber,
	parent: optional(isNonEmpty),
});

const isCarriedProject: Guard<CarriedProject> = fields<CarriedProject>({
	id: isNonEmpty,
	name: isNonEmpty,
	about: isString,
	goal: isString,
	decisions: arrayOf(isString),
	createdAt: isNumber,
	archivedAt: optional(isNumber),
	steps: arrayOf(isCarriedStep),
});

const decodeProjects = decoder<CarriedProject[]>(arrayOf(isCarriedProject));

/** The projects `value` holds, or `null` when it holds anything else, repeats an id, or nests a step under one that is no step of its project's top level. */
export function parseProjects(value: unknown): CarriedProject[] | null {
	const projects = decodeProjects(value);
	if (!projects) return null;
	const ids = new Set<string>();
	for (const project of projects) {
		if (ids.has(project.id)) return null;
		ids.add(project.id);
		const topSteps = new Set(project.steps.filter(step => step.parent === undefined).map(step => step.id));
		for (const step of project.steps) {
			if (ids.has(step.id)) return null;
			ids.add(step.id);
			if (step.parent !== undefined && !topSteps.has(step.parent)) return null;
		}
	}
	return projects;
}

const carriedStep = ({ id, title, task, createdAt, parent }: Thread & { task: TaskState }): CarriedStep => ({ id, title, task, createdAt, ...(parent === undefined ? {} : { parent }) });

/** The projects of `state` as sync carries them, in the Board's order. */
export function portableProjects(state: BoardState): CarriedProject[] {
	return state.channels.filter(isProjectChannel).map(({ id, name, about, project: { goal, decisions, createdAt, archivedAt } }) => ({
		id,
		name,
		about,
		goal,
		decisions,
		createdAt,
		...(archivedAt === undefined ? {} : { archivedAt }),
		steps: state.threads.filter((thread): thread is Thread & { task: TaskState } => thread.channel === id && thread.task !== null).map(carriedStep),
	}));
}

/**
 * `state` with exactly `projects` as its projects: each keeps the sessions this machine had in it and each step its lease
 * while its task is unchanged. A project or step `projects` lacks goes with its threads' messages and schedules; a
 * project whose name another channel here holds takes the next free name.
 */
export function withProjects(state: BoardState, projects: readonly CarriedProject[]): BoardState {
	const incoming = new Set(projects.map(project => project.id));
	const goneChannels = new Set(state.channels.filter(channel => isProjectChannel(channel) && !incoming.has(channel.id)).map(channel => channel.id));
	let channels = state.channels.filter(channel => !goneChannels.has(channel.id));
	for (const { id, name, about, goal, decisions, createdAt, archivedAt } of projects) {
		const here = channels.find(channel => channel.id === id);
		const others = channels.filter(channel => channel.id !== id);
		const project: ChannelProject = { goal, decisions, sessionIds: here?.project?.sessionIds ?? [], createdAt, ...(archivedAt === undefined ? {} : { archivedAt }) };
		const channel: Channel = { id, name: others.some(other => other.name === name) ? channelName({ ...state, channels: others }, name) : name, about, project };
		channels = here ? channels.map(other => (other.id === id ? channel : other)) : [...channels, channel];
	}
	const steps = new Map(projects.flatMap(project => project.steps.map(step => [step.id, { step, channel: project.id }] as const)));
	const gone = new Set<string>();
	const threads: Thread[] = [];
	for (const thread of state.threads) {
		const carried = steps.get(thread.id);
		if (carried) {
			const { step } = carried;
			const { parent: _, ...rest } = thread;
			threads.push({ ...rest, channel: carried.channel, title: step.title, task: step.task, lease: step.task === thread.task ? thread.lease : null, createdAt: step.createdAt, ...(step.parent === undefined ? {} : { parent: step.parent }) });
		} else if (goneChannels.has(thread.channel) || (incoming.has(thread.channel) && thread.task !== null)) {
			gone.add(thread.id);
		} else {
			threads.push(thread);
		}
	}
	const known = new Set(state.threads.map(thread => thread.id));
	for (const [id, { step, channel }] of steps) {
		if (!known.has(id)) threads.push({ id, channel, title: step.title, task: step.task, lease: null, createdAt: step.createdAt, ...(step.parent === undefined ? {} : { parent: step.parent }) });
	}
	const next: BoardState = {
		...state,
		channels,
		threads,
		messages: gone.size === 0 ? state.messages : state.messages.filter(message => !gone.has(message.thread)),
		schedules: gone.size === 0 ? state.schedules : state.schedules.filter(schedule => !gone.has(schedule.thread)),
	};
	return Bun.deepEquals(next, state) ? state : next;
}
