/**
 * The Board module's state: channels, threads, messages, the members who post them, and each member's unread queue.
 * The server keeps it in `board.json`; the page changes it through `module-change`, and a session through the `board`
 * tool's inbox. Both go through {@link applyBoardChange}. See `src/board-module.ts`.
 */
import { arrayOf, decoder, fields, type Guard, isBoolean, isNonEmpty, isNumber, isString, nullable, oneOf, optional, type Parsed, recordOf, type Shape, tagged } from "../json";
import { BOT_HUES, BOT_SHAPES, type Bot, type BotId, type BotLook, defaultLook, parseBotId } from "./bots";
import type { RosterHost } from "./sessions";

export type MemberKind = "human" | "agent" | "bot";
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

export type TaskState = "open" | "claimed" | "review" | "done" | "blocked";
export type StepState = "done" | "running" | "queued" | "failed";

export interface Lease {
	by: string;
	until: number;
}

export type Attachment =
	| { kind: "pr"; repo: string; number: number; title: string; state: "open" | "merged" | "draft"; checks: "passing" | "failing" | "running" }
	| { kind: "finding"; severity: "low" | "medium" | "high" | "critical"; repo: string; file: string; summary: string }
	| { kind: "workflow"; command: string; steps: { label: string; state: StepState }[] }
	| { kind: "schedule"; text: string; at: number; every: number | null }
	| { kind: "question"; options: string[]; picked: string | null };

export interface Message {
	id: string;
	thread: string;
	author: string;
	at: number;
	text: string;
	/** Internal notes stay on the board and never sync out. */
	internal?: boolean;
	attachment?: Attachment;
	/** Where it came from or goes to besides the board. */
	synced?: "slack" | "github" | "linear";
}

export interface Thread {
	id: string;
	channel: string;
	title: string;
	task: TaskState | null;
	lease: Lease | null;
	labels: string[];
	/** Thread ids that must be done before this one can start. */
	blockedBy: string[];
	createdAt: number;
}

export interface Channel {
	id: string;
	name: string;
	about: string;
	sync: "slack" | "github" | "linear" | null;
	restricted: boolean;
}

/** A message the board posts later, in `by`'s name, mentioning `to`; `every` milliseconds later again when it repeats. */
export interface Schedule {
	id: string;
	thread: string;
	by: string;
	to: string;
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
	| { op: "answer"; message: string; option: string }
	| { op: "progress"; message: string; step: number; state: StepState }
	| { op: "schedule"; schedule: Schedule }
	/** Posts schedule `schedule`'s message as message `message`, then moves it `every` later or drops it. */
	| { op: "fire"; schedule: string; message: string; at: number }
	| { op: "member"; member: Member };

const MIN = 60_000;
const HOUR = 60 * MIN;
/** How long `/claim` and the `board` tool's claim hold a task. */
export const LEASE_MS = HOUR;

const look = (id: string): BotLook => defaultLook(id as never);

/** The board a fresh `board.json` starts with: one empty channel and the user. */
export function emptyBoard(): BoardState {
	return {
		version: 1,
		me: "u-maxence",
		channels: [{ id: "c-general", name: "general", about: "", sync: null, restricted: false }],
		threads: [],
		messages: [],
		extraMembers: [{ id: "u-maxence", name: "Maxence", kind: "human", presence: "online", look: look("u-maxence"), initials: "M" }],
		schedules: [],
		readAt: {},
	};
}

/** Live session `host` as a board member. */
export function sessionMember(host: RosterHost): Member {
	return {
		id: `s-${host.sessionId}`,
		name: host.sessionName?.trim() || host.cwdDisplay.split("/").at(-1) || "session",
		kind: "agent",
		harness: `omp · ${host.model?.split("/").at(-1) ?? "this Mac"}`,
		presence: host.requests.length > 0 || host.status === "needs-input" ? "asking" : host.status === "working" ? "working" : "idle",
		look: look(host.sessionId),
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
	const botOf = (author: string) => bots.find(bot => bot.sessionId !== null && author === `s-${bot.sessionId}`);
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
	{ name: "done", about: "Settle this task, which opens the tasks waiting on it" },
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

export function unreadIn(state: BoardState, threadId: string): number {
	const mark = state.readAt[state.me]?.[threadId] ?? 0;
	return state.messages.filter(msg => msg.thread === threadId && msg.at > mark && msg.author !== state.me).length;
}

/** "every 2h" or "daily" for a repeat of `ms`. */
export function repeatLabel(ms: number): string {
	if (ms % (24 * HOUR) === 0) return ms === 24 * HOUR ? "daily" : `every ${ms / (24 * HOUR)}d`;
	return ms % HOUR === 0 ? `every ${ms / HOUR}h` : `every ${Math.round(ms / MIN)}m`;
}

/** Threads waiting on `threads`' done ones open. */
function unblock(threads: Thread[]): Thread[] {
	const done = new Set(threads.filter(thread => thread.task === "done").map(thread => thread.id));
	return threads.map(thread => (thread.task === "blocked" && thread.blockedBy.every(dep => done.has(dep)) ? { ...thread, task: "open" } : thread));
}

/** `state` after `change`, or why the board refuses it. */
export function applyBoardChange(state: BoardState, change: BoardChange): Parsed<BoardState, { error: string }> {
	const hasThread = (id: string) => state.threads.some(thread => thread.id === id);
	switch (change.op) {
		case "channel": {
			if (state.channels.some(channel => channel.id === change.channel.id)) return { ok: state };
			if (state.channels.some(channel => channel.name === change.channel.name)) return { error: `#${change.channel.name} already exists.` };
			return { ok: { ...state, channels: [...state.channels, change.channel] } };
		}
		case "thread": {
			if (hasThread(change.thread.id)) return { ok: state };
			if (!state.channels.some(channel => channel.id === change.thread.channel)) return { error: `No channel ${change.thread.channel}.` };
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
			return { ok: { ...state, threads: unblock(state.threads.map(thread => (thread.id === change.thread ? { ...thread, task: change.task, lease: change.lease } : thread))) } };
		case "answer": {
			const asked = state.messages.find(msg => msg.id === change.message)?.attachment;
			if (asked?.kind !== "question") return { error: `Message ${change.message} asks no question.` };
			if (asked.picked !== null) return { error: "That question is already answered." };
			if (!asked.options.includes(change.option)) return { error: `Answer with one of: ${asked.options.join(", ")}.` };
			return { ok: { ...state, messages: state.messages.map(msg => (msg.id === change.message ? { ...msg, attachment: { ...asked, picked: change.option } } : msg)) } };
		}
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
			const to = state.extraMembers.find(member => member.id === schedule.to);
			const posted: Message = { id: change.message, thread: schedule.thread, author: schedule.by, at: change.at, text: `${to ? `@${to.name} ` : ""}${schedule.text}` };
			// A repeat skips the runs it missed while the dashboard was down, rather than posting each.
			const next = schedule.every === null ? null : schedule.at + Math.ceil((change.at - schedule.at + 1) / schedule.every) * schedule.every;
			const schedules = next === null ? state.schedules.filter(item => item.id !== schedule.id) : state.schedules.map(item => (item.id === schedule.id ? { ...item, at: next } : item));
			return { ok: { ...state, schedules, messages: hasThread(schedule.thread) ? [...state.messages, posted] : state.messages } };
		}
		case "member": {
			const others = state.extraMembers.filter(member => member.id !== change.member.id);
			return { ok: { ...state, extraMembers: [...others, change.member] } };
		}
	}
}

const isLook: Guard<BotLook> = fields<BotLook>({ shape: oneOf(BOT_SHAPES), hue: oneOf(BOT_HUES) });
const isSync = oneOf(["slack", "github", "linear"] as const);
const isTask = oneOf(["open", "claimed", "review", "done", "blocked"] as const);
const isStepState = oneOf(["done", "running", "queued", "failed"] as const);
const isLease: Guard<Lease> = fields<Lease>({ by: isNonEmpty, until: isNumber });
const isMember: Guard<Member> = fields<Member>({
	id: isNonEmpty,
	name: isNonEmpty,
	kind: oneOf(["human", "agent", "bot"] as const),
	harness: optional(isString),
	presence: oneOf(["working", "idle", "asking", "asleep", "online", "away"] as const),
	look: isLook,
	initials: optional(isString),
	sessionId: optional(isNonEmpty),
	botId: optional((value: unknown): value is BotId => parseBotId(value) !== null),
});
const isAttachment = tagged<Attachment, "kind">("kind", {
	pr: { repo: isString, number: isNumber, title: isString, state: oneOf(["open", "merged", "draft"] as const), checks: oneOf(["passing", "failing", "running"] as const) },
	finding: { severity: oneOf(["low", "medium", "high", "critical"] as const), repo: isString, file: isString, summary: isString },
	workflow: { command: isString, steps: arrayOf(fields<{ label: string; state: StepState }>({ label: isString, state: isStepState })) },
	schedule: { text: isString, at: isNumber, every: nullable(isNumber) },
	question: { options: arrayOf(isNonEmpty), picked: nullable(isString) },
});
const isMessage: Guard<Message> = fields<Message>({
	id: isNonEmpty,
	thread: isNonEmpty,
	author: isNonEmpty,
	at: isNumber,
	text: isString,
	internal: optional(isBoolean),
	attachment: optional(isAttachment),
	synced: optional(isSync),
});
const isSchedule: Guard<Schedule> = fields<Schedule>({ id: isNonEmpty, thread: isNonEmpty, by: isNonEmpty, to: isNonEmpty, text: isString, at: isNumber, every: nullable(isNumber) });
const isChannel: Guard<Channel> = fields<Channel>({ id: isNonEmpty, name: isNonEmpty, about: isString, sync: nullable(isSync), restricted: isBoolean });
const isThread: Guard<Thread> = fields<Thread>({ id: isNonEmpty, channel: isNonEmpty, title: isString, task: nullable(isTask), lease: nullable(isLease), labels: arrayOf(isString), blockedBy: arrayOf(isNonEmpty), createdAt: isNumber });

const CHANGE_SHAPES: { [Op in BoardChange["op"]]: Shape<Omit<Extract<BoardChange, { op: Op }>, "op">> } = {
	channel: { channel: isChannel },
	thread: { thread: isThread },
	post: { message: isMessage },
	read: { member: isNonEmpty, thread: isNonEmpty, at: isNumber },
	task: { thread: isNonEmpty, task: nullable(isTask), lease: nullable(isLease) },
	answer: { message: isNonEmpty, option: isNonEmpty },
	progress: { message: isNonEmpty, step: isNumber, state: isStepState },
	schedule: { schedule: isSchedule },
	fire: { schedule: isNonEmpty, message: isNonEmpty, at: isNumber },
	member: { member: isMember },
};

/** A change as a page or a session sent it, or `null` when it is none. */
export const parseBoardChange = decoder<BoardChange>(tagged<BoardChange, "op">("op", CHANGE_SHAPES));

/** What `board.json` holds, or `null` for anything else. */
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
