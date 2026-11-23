/**
 * The Board module's state: channels, threads, messages, the members who post them, and each member's unread queue.
 * The server keeps it in `board.json`; the page changes it through `module-change`, and a session through the `board`
 * tool's inbox. Both go through {@link applyBoardChange}. See `src/board-module.ts`.
 */
import { arrayOf, decoder, fields, type Guard, isBoolean, isNonEmpty, isNumber, isString, nullable, oneOf, optional, type Parsed, recordOf, type Shape, tagged } from "../json";
import { BOT_HUES, BOT_SHAPES, type Bot, type BotId, type BotLook, defaultLook, parseBotId } from "./bots";
import type { RosterHost } from "./sessions";

export type MemberKind = "human" | "agent";
export type Presence = "working" | "idle" | "asking" | "asleep" | "online" | "away";

export interface Member {
	id: string;
	name: string;
	kind: MemberKind;
	/** The harness or vendor an agent runs on. */
	harness?: string;
	presence: Presence;
	look: BotLook;
	/** A human's initials. */
	initials?: string;
	/** The omp session this member is, which a message for it wakes; a Bot's is its conversation, while it has one. */
	sessionId?: string;
	/** The Bot this member is, which a message for it wakes through its conversation. */
	botId?: BotId;
}

export type TaskState = "open" | "claimed" | "review" | "done";
export type StepState = "done" | "running" | "queued" | "failed";

export interface Lease {
	by: string;
	until: number;
}

export type Attachment = { kind: "workflow"; command: string; steps: { label: string; state: StepState }[] } | { kind: "schedule"; text: string; at: number; every: number | null };

export interface Message {
	id: string;
	thread: string;
	author: string;
	at: number;
	text: string;
	/** Internal notes stay on the board and never sync out. */
	internal?: boolean;
	/** The directory a session this message starts runs in, which the composer's workspace picker sets outside a project. */
	cwd?: string;
	attachment?: Attachment;
}

export interface Thread {
	id: string;
	channel: string;
	title: string;
	task: TaskState | null;
	lease: Lease | null;
	createdAt: number;
	/** The step this thread is a sub-step of, in the same project channel; a sub-step has none of its own, so a plan nests two levels at most. */
	parent?: string;
}

/** What makes a channel a Project: an effort that spans sessions and workspaces, whose task threads are its plan and whose messages are its log. */
export interface ChannelProject {
	goal: string;
	decisions: string[];
	/** The sessions in the project, in the order they joined; a session is in one project at most. */
	sessionIds: string[];
	createdAt: number;
	/** When the project was archived, which drops it from the roster and from the briefs; absent while it is open. */
	archivedAt?: number;
}

export interface Channel {
	id: string;
	name: string;
	about: string;
	project?: ChannelProject;
}

/** A project channel: a channel that carries its {@link ChannelProject}. */
export type ProjectChannel = Channel & { project: ChannelProject };

/** A message the board posts later, in `by`'s name, mentioning `to`; `every` milliseconds later again when it repeats. */
export interface Schedule {
	id: string;
	thread: string;
	by: string;
	to: string;
	/** `to`'s name when the schedule was made, which the post mentions; a schedule saved before it existed looks `to` up in the kept members. */
	toName?: string;
	text: string;
	at: number;
	every: number | null;
}

export interface BoardState {
	version: 1;
	me: string;
	channels: Channel[];
	threads: Thread[];
	messages: Message[];
	/** The members the roster does not give: people, remote agents, and sessions that posted or were mentioned, kept once they end. */
	extraMembers: Member[];
	schedules: Schedule[];
	/** For each member, the last time they read each thread. */
	readAt: Record<string, Record<string, number>>;
}

export type BoardChange =
	| { op: "channel"; channel: Channel }
	| { op: "thread"; thread: Thread }
	| { op: "post"; message: Message }
	| { op: "read"; member: string; thread: string; at: number }
	| { op: "task"; thread: string; task: TaskState | null; lease: Lease | null }
	| { op: "progress"; message: string; step: number; state: StepState }
	| { op: "schedule"; schedule: Schedule }
	/** Posts schedule `schedule`'s message as message `message`, then moves it `every` later or drops it. */
	| { op: "fire"; schedule: string; message: string; at: number }
	| { op: "member"; member: Member }
	/** Renames channel `channel`; a project's name is its channel's. */
	| { op: "rename"; channel: string; name: string }
	/** Retitles thread `thread`, such as a plan step's text. */
	| { op: "retitle"; thread: string; title: string }
	/** Removes thread `thread`, its sub-steps, their messages, and their schedules. */
	| { op: "remove-thread"; thread: string }
	| { op: "set-goal"; channel: string; goal: string }
	/** Archives project channel `channel` at `at`, or restores it when `at` is null. */
	| { op: "archive"; channel: string; at: number | null }
	/** Adds decision `text` to project channel `channel`, or removes it. */
	| { op: "decision"; channel: string; text: string; remove: boolean }
	/** Puts session `sessionId` in project channel `channel`, out of any other. */
	| { op: "join"; channel: string; sessionId: string }
	| { op: "leave"; sessionId: string }
	/** Every change in `changes`, in order, or none of them when one is refused. */
	| { op: "all"; changes: BoardChange[] };

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** How long `/claim` and the `board` tool's claim hold a task. */
export const LEASE_MS = HOUR;

/** The board a fresh `board.json` starts with: one empty channel and `owner`, the person who runs the dashboard. */
export function emptyBoard(owner: string): BoardState {
	const id = `u-${owner.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`;
	return {
		version: 1,
		me: id,
		channels: [{ id: "c-general", name: "general", about: "" }],
		threads: [],
		messages: [],
		extraMembers: [{ id, name: owner, kind: "human", presence: "online", look: defaultLook(id), initials: owner.slice(0, 1).toUpperCase() }],
		schedules: [],
		readAt: {},
	};
}

/** Session `sessionId`'s board member id. */
export const sessionMemberId = (sessionId: string): string => `s-${sessionId}`;

/** Live session `host` as a board member. */
export function sessionMember(host: RosterHost): Member {
	return {
		id: sessionMemberId(host.sessionId),
		name: host.sessionName?.trim() || host.cwdDisplay.split("/").at(-1) || "session",
		kind: "agent",
		harness: `omp · ${host.model?.split("/").at(-1) ?? "this Mac"}`,
		presence: host.requests.length > 0 || host.status === "needs-input" ? "asking" : host.status === "working" ? "working" : "idle",
		look: defaultLook(host.sessionId),
		sessionId: host.sessionId,
	};
}

/** Bot `bot`'s board member id. */
export const botMemberId = (id: BotId): string => `bot:${id}`;

/** Bot `bot` as a board member: as busy as `host`, its conversation's live session, or asleep without one. */
export function botMember(bot: Bot, host: RosterHost | undefined): Member {
	return {
		id: botMemberId(bot.id),
		name: bot.name,
		kind: "agent",
		harness: "Bot",
		presence: host ? sessionMember(host).presence : "asleep",
		look: { shape: bot.shape, hue: bot.hue },
		botId: bot.id,
		...(bot.sessionId === null ? {} : { sessionId: bot.sessionId }),
	};
}

/**
 * Every member: the board's own, with the Bots and the live sessions over the ones it kept, which are asleep until their
 * session runs again. A Bot's conversation is listed once, as the Bot.
 */
export function boardMembers(state: BoardState, hosts: readonly RosterHost[], bots: readonly Bot[]): Member[] {
	const botSessions = new Set(bots.flatMap(bot => bot.sessionId ?? []));
	const live = [...bots.map(bot => botMember(bot, hosts.find(host => host.sessionId === bot.sessionId))), ...hosts.filter(host => !botSessions.has(host.sessionId)).map(sessionMember)];
	const liveIds = new Set(live.map(member => member.id));
	return [...state.extraMembers.filter(member => !liveIds.has(member.id) && !(!member.botId && member.sessionId !== undefined && botSessions.has(member.sessionId))), ...live];
}

/** `change` as a session's `board` tool left it, in its Bot's name when the session is a Bot's conversation. */
export function inBotsName(change: BoardChange, bots: readonly Bot[]): BoardChange {
	const botOf = (author: string) => bots.find(bot => bot.sessionId !== null && author === sessionMemberId(bot.sessionId));
	if (change.op === "all") return { ...change, changes: change.changes.map(item => inBotsName(item, bots)) };
	if (change.op === "post") {
		const bot = botOf(change.message.author);
		return bot ? { ...change, message: { ...change.message, author: botMemberId(bot.id) } } : change;
	}
	if (change.op === "task" && change.lease) {
		const bot = botOf(change.lease.by);
		return bot ? { ...change, lease: { ...change.lease, by: botMemberId(bot.id) } } : change;
	}
	return change;
}

/** A command typed after `/` at the start of a message. */
export interface BoardCommand {
	name: string;
	about: string;
	/** A workflow's steps, which its card lists; a task command has none. */
	steps?: readonly string[];
	/** Offered as a button under the composer. */
	quick?: true;
}

export const BOARD_COMMANDS: readonly BoardCommand[] = [
	{ name: "review", about: "Run the review panel on this thread and post the verdict here", steps: ["Interface review", "Thermonuclear review", "Cross-judge (Codex)"], quick: true },
	{ name: "implement", about: "Have an agent claim this task, build it, and report back", steps: ["Claim task", "Implement", "Open PR", "Report back"], quick: true },
	{ name: "grill", about: "Stress-test the plan in this thread with two models", steps: ["Claude grills", "Codex grills", "Merge findings"] },
	{ name: "schedule", about: "Post to an agent later: /schedule @name text in 10m, or every 2h", quick: true },
	{ name: "claim", about: "Take this task with a one-hour lease" },
	{ name: "done", about: "Settle this task" },
];

/** `text` as a command, its name and what follows it, or `null` for a plain post. */
export function parseCommand(text: string): { command: BoardCommand; arg: string } | null {
	const match = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/);
	const command = match && BOARD_COMMANDS.find(item => item.name === match[1]);
	return command ? { command, arg: match[2] ?? "" } : null;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `@` and one of `members`' names, in any case, after the start or a space and before a space, punctuation, or the end.
 * Longer names come first, so `@Max Power` is not `@Max`. Group 1 is the name as written; the expression is global.
 */
export function mentionPattern(members: readonly Pick<Member, "name">[]): RegExp | null {
	if (members.length === 0) return null;
	const names = members.map(member => member.name).toSorted((a, b) => b.length - a.length);
	return new RegExp(`(?<=^|\\s)@(${names.map(escapeRegExp).join("|")})(?=[\\s,.;:!?)\\]]|$)`, "giu");
}

/** Each member `text` mentions, where it does, left to right. */
export function mentions(text: string, members: readonly Member[]): { member: Member; start: number; end: number }[] {
	const pattern = mentionPattern(members);
	if (!pattern) return [];
	const byName = new Map(members.map(member => [member.name.toLowerCase(), member]));
	return [...text.matchAll(pattern)].flatMap(match => {
		const member = byName.get(match[1]!.toLowerCase());
		return member ? [{ member, start: match.index, end: match.index + match[0].length }] : [];
	});
}

export const isMention = (text: string, member: Member): boolean => mentions(text, [member]).length > 0;

/** What waits for `member`: messages in threads they posted in or that mention them, newer than their read mark, not their own. */
export function queueOf(state: BoardState, member: Member): Message[] {
	const joined = new Set(state.messages.filter(msg => msg.author === member.id).map(msg => msg.thread));
	const marks = state.readAt[member.id] ?? {};
	return state.messages.filter(msg => msg.author !== member.id && msg.at > (marks[msg.thread] ?? 0) && (joined.has(msg.thread) || isMention(msg.text, member)));
}

/** What the page looks up by id or per thread, built once per state rather than by scanning every message per row. */
export interface BoardIndex {
	threadById: Map<string, Thread>;
	channelById: Map<string, Channel>;
	memberById: Map<string, Member>;
	messagesByThread: Map<string, Message[]>;
	lastByThread: Map<string, Message>;
	/** How many messages in each thread the board's owner has not read; a thread with none is absent. */
	unreadByThread: Map<string, number>;
	/** {@link queueOf} for each member. */
	queueByMember: Map<string, Message[]>;
}

export function boardIndex(state: BoardState, members: readonly Member[]): BoardIndex {
	const messagesByThread = Map.groupBy(state.messages, msg => msg.thread);
	const lastByThread = new Map([...messagesByThread].map(([thread, msgs]) => [thread, msgs.at(-1)!]));
	const myMarks = state.readAt[state.me] ?? {};
	const unreadByThread = new Map<string, number>();
	for (const msg of state.messages) if (msg.author !== state.me && msg.at > (myMarks[msg.thread] ?? 0)) unreadByThread.set(msg.thread, (unreadByThread.get(msg.thread) ?? 0) + 1);
	const memberIds = new Set(members.map(member => member.id));
	const joined = new Map<string, Set<string>>();
	for (const msg of state.messages) if (memberIds.has(msg.author)) joined.set(msg.author, (joined.get(msg.author) ?? new Set()).add(msg.thread));
	// Each message's text is matched against the roster once, not once per member.
	const mentioned = new Map(state.messages.map(msg => [msg, new Set(mentions(msg.text, members).map(found => found.member.id))]));
	const queueByMember = new Map(
		members.map(member => {
			const marks = state.readAt[member.id] ?? {};
			const threads = joined.get(member.id);
			return [member.id, state.messages.filter(msg => msg.author !== member.id && msg.at > (marks[msg.thread] ?? 0) && (threads?.has(msg.thread) || mentioned.get(msg)!.has(member.id)))];
		}),
	);
	return {
		threadById: new Map(state.threads.map(thread => [thread.id, thread])),
		channelById: new Map(state.channels.map(channel => [channel.id, channel])),
		memberById: new Map(members.map(member => [member.id, member])),
		messagesByThread,
		lastByThread,
		unreadByThread,
		queueByMember,
	};
}

/** "every 2h" or "daily" for a repeat of `ms`. */
export function repeatLabel(ms: number): string {
	if (ms % DAY === 0) return ms === DAY ? "daily" : `every ${ms / DAY}d`;
	return ms % HOUR === 0 ? `every ${ms / HOUR}h` : `every ${Math.round(ms / MIN)}m`;
}

const UNITS: Record<string, number> = { m: MIN, h: HOUR, d: DAY };

/** What running `command` with `arg` in thread `thread` changes, as `me` at `now`; `newId` names each message and schedule it makes. */
export function commandChanges({ members, me, thread, command, arg, now, newId }: { members: readonly Member[]; me: string; thread: Thread; command: BoardCommand; arg: string; now: number; newId: () => string }): BoardChange[] {
	const post = (text: string, extra: Partial<Message> = {}): BoardChange => ({ op: "post", message: { id: newId(), thread: thread.id, author: me, at: now, text, ...extra } });
	switch (command.name) {
		case "claim":
			return [{ op: "task", thread: thread.id, task: "claimed", lease: { by: me, until: now + LEASE_MS } }, post("Claimed. Lease 1h.")];
		case "done":
			return [{ op: "task", thread: thread.id, task: "done", lease: null }, post(arg || "Done.")];
		case "schedule": {
			const [to] = mentions(arg, members);
			if (!to) return [post("/schedule needs an @member to post to.", { internal: true })];
			const every = arg.match(/\bevery (\d+)\s*([mhd])\b/);
			const after = arg.match(/\bin (\d+)\s*([mhd])\b/);
			const step = (match: RegExpMatchArray) => Number(match[1]) * UNITS[match[2]!]!;
			const repeat = every ? step(every) : null;
			const at = now + (after ? step(after) : (repeat ?? 5 * MIN));
			const text = (arg.slice(0, to.start) + arg.slice(to.end)).replace(/\b(every|in) \d+\s*[mhd]\b/g, "").replace(/\s+/g, " ").trim() || "Check back on this thread.";
			return [
				{ op: "schedule", schedule: { id: newId(), thread: thread.id, by: me, to: to.member.id, toName: to.member.name, text, at, every: repeat } },
				post(`Scheduled for ${to.member.name}`, { internal: true, attachment: { kind: "schedule", text, at, every: repeat } }),
			];
		}
		default: {
			// The workflow goes to the agent it mentions, else to the agent holding the task.
			const holder = thread.lease ? members.find(member => member.id === thread.lease!.by) : undefined;
			const target = mentions(arg, members).find(({ member }) => member.kind !== "human")?.member ?? (holder?.kind === "human" ? undefined : holder);
			const text = `/${command.name}${target && !isMention(arg, target) ? ` @${target.name}` : ""}${arg ? ` ${arg}` : ""}`;
			return [post(text, { attachment: { kind: "workflow", command: `/${command.name}`, steps: (command.steps ?? []).map(label => ({ label, state: "queued" })) } })];
		}
	}
}

/** `state` after `change`, or why the board refuses it. */
export function applyBoardChange(state: BoardState, change: BoardChange): Parsed<BoardState, { error: string }> {
	const hasThread = (id: string) => state.threads.some(thread => thread.id === id);
	switch (change.op) {
		case "all": {
			let next = state;
			for (const item of change.changes) {
				const applied = applyBoardChange(next, item);
				if ("error" in applied) return applied;
				next = applied.ok;
			}
			return { ok: next };
		}
		case "channel": {
			if (state.channels.some(channel => channel.id === change.channel.id)) return { ok: state };
			if (state.channels.some(channel => channel.name === change.channel.name)) return { error: `#${change.channel.name} already exists.` };
			return { ok: { ...state, channels: [...state.channels, change.channel] } };
		}
		case "thread": {
			if (hasThread(change.thread.id)) return { ok: state };
			if (!state.channels.some(channel => channel.id === change.thread.channel)) return { error: `No channel ${change.thread.channel}.` };
			if (change.thread.parent !== undefined) {
				const parent = state.threads.find(thread => thread.id === change.thread.parent);
				if (!parent || parent.channel !== change.thread.channel) return { error: `No step ${change.thread.parent} in that channel to hold a sub-step.` };
				if (parent.parent !== undefined) return { error: "A sub-step holds no steps of its own: a plan nests two levels at most." };
			}
			return { ok: { ...state, threads: [...state.threads, change.thread] } };
		}
		case "post": {
			if (!hasThread(change.message.thread)) return { error: `No thread ${change.message.thread}.` };
			if (state.messages.some(msg => msg.id === change.message.id)) return { ok: state };
			return { ok: { ...state, messages: [...state.messages, change.message] } };
		}
		case "read":
			if ((state.readAt[change.member]?.[change.thread] ?? 0) >= change.at) return { ok: state };
			return { ok: { ...state, readAt: { ...state.readAt, [change.member]: { ...state.readAt[change.member], [change.thread]: change.at } } } };
		case "task":
			if (!hasThread(change.thread)) return { error: `No thread ${change.thread}.` };
			return { ok: { ...state, threads: state.threads.map(thread => (thread.id === change.thread ? { ...thread, task: change.task, lease: change.lease } : thread)) } };
		case "progress": {
			const workflow = state.messages.find(msg => msg.id === change.message)?.attachment;
			if (workflow?.kind !== "workflow") return { error: `Message ${change.message} runs no workflow.` };
			if (!Number.isInteger(change.step) || change.step < 0 || change.step >= workflow.steps.length) return { error: `step is 0 to ${workflow.steps.length - 1}.` };
			const steps = workflow.steps.map((step, i) => (i === change.step ? { ...step, state: change.state } : step));
			return { ok: { ...state, messages: state.messages.map(msg => (msg.id === change.message ? { ...msg, attachment: { ...workflow, steps } } : msg)) } };
		}
		case "schedule":
			if (!hasThread(change.schedule.thread)) return { error: `No thread ${change.schedule.thread}.` };
			if (state.schedules.some(item => item.id === change.schedule.id)) return { ok: state };
			return { ok: { ...state, schedules: [...state.schedules, change.schedule] } };
		case "fire": {
			const schedule = state.schedules.find(item => item.id === change.schedule);
			if (!schedule || schedule.at > change.at) return { ok: state };
			const toName = schedule.toName ?? state.extraMembers.find(member => member.id === schedule.to)?.name;
			const posted: Message = { id: change.message, thread: schedule.thread, author: schedule.by, at: change.at, text: `${toName ? `@${toName} ` : ""}${schedule.text}` };
			// A repeat skips the runs it missed while the dashboard was down, rather than posting each.
			const next = schedule.every === null ? null : schedule.at + Math.ceil((change.at - schedule.at + 1) / schedule.every) * schedule.every;
			const schedules = next === null ? state.schedules.filter(item => item.id !== schedule.id) : state.schedules.map(item => (item.id === schedule.id ? { ...item, at: next } : item));
			return { ok: { ...state, schedules, messages: hasThread(schedule.thread) ? [...state.messages, posted] : state.messages } };
		}
		case "member": {
			const others = state.extraMembers.filter(member => member.id !== change.member.id);
			return { ok: { ...state, extraMembers: [...others, change.member] } };
		}
		case "rename": {
			if (state.channels.some(channel => channel.name === change.name && channel.id !== change.channel)) return { error: `#${change.name} already exists.` };
			return editChannel(state, change.channel, channel => (channel.name === change.name ? channel : { ...channel, name: change.name }));
		}
		case "retitle":
			if (!hasThread(change.thread)) return { error: `No thread ${change.thread}.` };
			return { ok: { ...state, threads: state.threads.map(thread => (thread.id === change.thread && thread.title !== change.title ? { ...thread, title: change.title } : thread)) } };
		case "remove-thread": {
			if (!hasThread(change.thread)) return { ok: state };
			const gone = new Set(state.threads.filter(thread => thread.id === change.thread || thread.parent === change.thread).map(thread => thread.id));
			return {
				ok: {
					...state,
					threads: state.threads.filter(thread => !gone.has(thread.id)),
					messages: state.messages.filter(msg => !gone.has(msg.thread)),
					schedules: state.schedules.filter(item => !gone.has(item.thread)),
				},
			};
		}
		case "set-goal":
			return editProject(state, change.channel, project => (project.goal === change.goal ? project : { ...project, goal: change.goal }));
		case "archive":
			return editProject(state, change.channel, project => {
				if (change.at === null) {
					if (project.archivedAt === undefined) return project;
					const { archivedAt: _, ...open } = project;
					return open;
				}
				return project.archivedAt === undefined ? { ...project, archivedAt: change.at } : project;
			});
		case "decision":
			return editProject(state, change.channel, project => {
				const has = project.decisions.includes(change.text);
				if (has !== change.remove) return project;
				return { ...project, decisions: change.remove ? project.decisions.filter(text => text !== change.text) : [...project.decisions, change.text] };
			});
		case "join": {
			const target = state.channels.find(channel => channel.id === change.channel);
			if (!target?.project) return { error: `No project channel ${change.channel}.` };
			if (target.project.sessionIds.includes(change.sessionId)) return { ok: state };
			return editProject(leaveProjects(state, change.sessionId), change.channel, project => ({ ...project, sessionIds: [...project.sessionIds, change.sessionId] }));
		}
		case "leave":
			return { ok: leaveProjects(state, change.sessionId) };
	}
}

function editChannel(state: BoardState, id: string, edit: (channel: Channel) => Channel | { error: string }): Parsed<BoardState, { error: string }> {
	const index = state.channels.findIndex(channel => channel.id === id);
	const channel = state.channels[index];
	if (!channel) return { error: `No channel ${id}.` };
	const edited = edit(channel);
	if ("error" in edited) return edited;
	return { ok: edited === channel ? state : { ...state, channels: state.channels.with(index, edited) } };
}

function editProject(state: BoardState, id: string, edit: (project: ChannelProject) => ChannelProject): Parsed<BoardState, { error: string }> {
	return editChannel(state, id, channel => {
		if (!channel.project) return { error: `#${channel.name} is no project.` };
		const project = edit(channel.project);
		return project === channel.project ? channel : { ...channel, project };
	});
}

/** `state` with session `sessionId` in no project, the same object when it was in none. */
function leaveProjects(state: BoardState, sessionId: string): BoardState {
	if (!state.channels.some(channel => channel.project?.sessionIds.includes(sessionId))) return state;
	return {
		...state,
		channels: state.channels.map(channel =>
			channel.project?.sessionIds.includes(sessionId) ? { ...channel, project: { ...channel.project, sessionIds: channel.project.sessionIds.filter(id => id !== sessionId) } } : channel,
		),
	};
}

/** A channel name made from `text`, such as a project's name, lowercase with hyphens, and suffixed `-2`, `-3`… past the names `state` already has. */
export function channelName(state: BoardState, text: string): string {
	const base = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "project";
	const taken = new Set(state.channels.map(channel => channel.name));
	let name = base;
	for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
	return name;
}

export const isProjectChannel = (channel: Channel): channel is ProjectChannel => channel.project !== undefined;

/** The open projects, oldest first, which the roster and the briefs show. */
export const openProjectChannels = (state: BoardState): ProjectChannel[] => state.channels.filter(isProjectChannel).filter(channel => channel.project.archivedAt === undefined);

/** The project session `sessionId` is in, or `undefined`. */
export const projectOfSession = (state: BoardState, sessionId: string): ProjectChannel | undefined =>
	state.channels.filter(isProjectChannel).find(channel => channel.project.sessionIds.includes(sessionId));

/** A project channel's plan: its task threads, each step followed by its sub-steps, oldest first. */
export function planOf(state: BoardState, channel: string): Thread[] {
	const steps = state.threads.filter(thread => thread.channel === channel && thread.task !== null);
	return steps.filter(step => step.parent === undefined).flatMap(step => [step, ...steps.filter(sub => sub.parent === step.id)]);
}

/** Each step's number in a plan from {@link planOf}: `2` for its second step, `2.1` for the first sub-step under it. */
export function stepNumbers(plan: readonly Thread[]): Map<string, string> {
	const numbers = new Map<string, string>();
	const subs = new Map<string, number>();
	let top = 0;
	for (const step of plan) {
		if (step.parent === undefined) numbers.set(step.id, String(++top));
		else {
			const count = (subs.get(step.parent) ?? 0) + 1;
			subs.set(step.parent, count);
			numbers.set(step.id, `${numbers.get(step.parent)}.${count}`);
		}
	}
	return numbers;
}

const isLook: Guard<BotLook> = fields<BotLook>({ shape: oneOf(BOT_SHAPES), hue: oneOf(BOT_HUES) });
const isTask = oneOf(["open", "claimed", "review", "done"] as const);
const isStepState = oneOf(["done", "running", "queued", "failed"] as const);
const isLease: Guard<Lease> = fields<Lease>({ by: isNonEmpty, until: isNumber });
const isMember: Guard<Member> = fields<Member>({
	id: isNonEmpty,
	name: isNonEmpty,
	kind: oneOf(["human", "agent"] as const),
	harness: optional(isString),
	presence: oneOf(["working", "idle", "asking", "asleep", "online", "away"] as const),
	look: isLook,
	initials: optional(isString),
	sessionId: optional(isNonEmpty),
	botId: optional((value: unknown): value is BotId => parseBotId(value) !== null),
});
const isAttachment = tagged<Attachment, "kind">("kind", {
	workflow: { command: isString, steps: arrayOf(fields<{ label: string; state: StepState }>({ label: isString, state: isStepState })) },
	schedule: { text: isString, at: isNumber, every: nullable(isNumber) },
});
const isMessage: Guard<Message> = fields<Message>({ id: isNonEmpty, thread: isNonEmpty, author: isNonEmpty, at: isNumber, text: isString, internal: optional(isBoolean), attachment: optional(isAttachment), cwd: optional(isNonEmpty) });
const isSchedule: Guard<Schedule> = fields<Schedule>({ id: isNonEmpty, thread: isNonEmpty, by: isNonEmpty, to: isNonEmpty, toName: optional(isNonEmpty), text: isString, at: isNumber, every: nullable(isNumber) });
const isChannelProject: Guard<ChannelProject> = fields<ChannelProject>({ goal: isString, decisions: arrayOf(isString), sessionIds: arrayOf(isNonEmpty), createdAt: isNumber, archivedAt: optional(isNumber) });
const isChannel: Guard<Channel> = fields<Channel>({ id: isNonEmpty, name: isNonEmpty, about: isString, project: optional(isChannelProject) });
const isThread: Guard<Thread> = fields<Thread>({ id: isNonEmpty, channel: isNonEmpty, title: isString, task: nullable(isTask), lease: nullable(isLease), createdAt: isNumber, parent: optional(isNonEmpty) });

const isChanges = (value: unknown): value is BoardChange[] => arrayOf(isChange)(value);

const CHANGE_SHAPES: { [Op in BoardChange["op"]]: Shape<Omit<Extract<BoardChange, { op: Op }>, "op">> } = {
	channel: { channel: isChannel },
	thread: { thread: isThread },
	post: { message: isMessage },
	read: { member: isNonEmpty, thread: isNonEmpty, at: isNumber },
	task: { thread: isNonEmpty, task: nullable(isTask), lease: nullable(isLease) },
	progress: { message: isNonEmpty, step: isNumber, state: isStepState },
	schedule: { schedule: isSchedule },
	fire: { schedule: isNonEmpty, message: isNonEmpty, at: isNumber },
	member: { member: isMember },
	rename: { channel: isNonEmpty, name: isNonEmpty },
	retitle: { thread: isNonEmpty, title: isNonEmpty },
	"remove-thread": { thread: isNonEmpty },
	"set-goal": { channel: isNonEmpty, goal: isString },
	archive: { channel: isNonEmpty, at: nullable(isNumber) },
	decision: { channel: isNonEmpty, text: isNonEmpty, remove: isBoolean },
	join: { channel: isNonEmpty, sessionId: isNonEmpty },
	leave: { sessionId: isNonEmpty },
	all: { changes: isChanges },
};

const isChange = tagged<BoardChange, "op">("op", CHANGE_SHAPES);

/** A change as a page or a session sent it, or `null` when it is none. */
export const parseBoardChange = decoder<BoardChange>(isChange);

/** What `board.json` holds, or `null` for anything else. Fields older boards kept, such as a channel's `sync`, are ignored. */
export const parseBoardState = decoder<BoardState>(
	fields<BoardState>({
		version: oneOf([1] as const),
		me: isNonEmpty,
		channels: arrayOf(isChannel),
		threads: arrayOf(isThread),
		messages: arrayOf(isMessage),
		extraMembers: arrayOf(isMember),
		schedules: arrayOf(isSchedule),
		readAt: recordOf(recordOf(isNumber)),
	}),
);
