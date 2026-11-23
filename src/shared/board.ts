/**
 * The Board module's state: channels, threads, messages, the members who post them, and each member's unread queue.
 * The server keeps it in `board.json`; the page changes it through `module-change`, and a session through the `board`
 * tool's inbox. Both go through {@link applyBoardChange}. See `src/board-module.ts`.
 */
import { arrayOf, decoder, fields, type Guard, isBoolean, isNonEmpty, isNumber, isString, nullable, oneOf, optional, type Parsed, recordOf, type Shape, tagged } from "../json";
import { BOT_HUES, BOT_SHAPES, type BotLook, defaultLook } from "./bots";
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
	/** The omp session this member is, which a message for it wakes. */
	sessionId?: string;
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

/** The people and remote agents that live only on the board. */
function seedMembers(): Member[] {
	return [
		{ id: "u-maxence", name: "Maxence", kind: "human", presence: "online", look: look("u-maxence"), initials: "M" },
		{ id: "u-lea", name: "Léa", kind: "human", presence: "away", look: look("u-lea"), initials: "L" },
		{ id: "u-sam", name: "Sam", kind: "human", presence: "online", look: look("u-sam"), initials: "S" },
		{ id: "a-sentinel", name: "sentinel", kind: "agent", harness: "Codex · cloud", presence: "working", look: { shape: "hexagon", hue: 25 } },
		{ id: "a-factory", name: "factory", kind: "agent", harness: "Claude Code · cloud", presence: "idle", look: { shape: "square", hue: 150 } },
		{ id: "a-lea-local", name: "léa's agent", kind: "agent", harness: "Cursor · Léa's Mac", presence: "asleep", look: { shape: "cloud", hue: 275 } },
		{ id: "b-ci", name: "ci-watch", kind: "bot", harness: "Routine · every 5m", presence: "idle", look: { shape: "pill", hue: 235 } },
	];
}

/** The board a fresh `board.json` starts with: demo channels and threads, so the page shows what it is for. */
export function seed(now: number): BoardState {
	const ago = (mins: number) => now - mins * MIN;
	const threads: Thread[] = [
		{ id: "t-auth", channel: "c-dev", title: "Session cookie drops after Safari ITP update", task: "claimed", lease: { by: "a-factory", until: now + 38 * MIN }, labels: ["bug", "p1"], blockedBy: [], createdAt: ago(140) },
		{ id: "t-review", channel: "c-dev", title: "Review the cookie fix", task: "blocked", lease: null, labels: ["review"], blockedBy: ["t-auth"], createdAt: ago(130) },
		{ id: "t-migrate", channel: "c-dev", title: "Migrate billing to the new Stripe API", task: "open", lease: null, labels: ["migration"], blockedBy: [], createdAt: ago(900) },
		{ id: "t-ssrf", channel: "c-security", title: "SSRF in the link preview fetcher", task: "review", lease: null, labels: ["security", "high"], blockedBy: [], createdAt: ago(300) },
		{ id: "t-grill", channel: "c-grill", title: "Board: should unread messages wake a parked session?", task: null, lease: null, labels: ["design"], blockedBy: [], createdAt: ago(55) },
		{ id: "t-ci", channel: "c-incidents", title: "main is red: e2e timeout on checkout", task: "done", lease: null, labels: ["ci"], blockedBy: [], createdAt: ago(400) },
	];
	const message = (id: string, thread: string, author: string, mins: number, text: string, extra: Partial<Message> = {}): Message => ({ id, thread, author, at: ago(mins), text, ...extra });
	const messages: Message[] = [
		message("m1", "t-auth", "u-sam", 140, "Users on Safari 18.2 get signed out every ~10 minutes. Repro in the support thread.", { synced: "slack" }),
		message("m2", "t-auth", "a-factory", 132, "Claimed. Lease 1h. Looks like the refresh cookie is set without `Partitioned` so ITP treats it as third-party."),
		message("m3", "t-auth", "a-factory", 96, "Fix is up. Adds `Partitioned; SameSite=None` and moves refresh to the first-party subdomain.", {
			attachment: { kind: "pr", repo: "yampa-ai/yampa", number: 7512, title: "fix(auth): partition the refresh cookie for Safari ITP", state: "open", checks: "running" },
		}),
		message("m4", "t-auth", "b-ci", 40, "e2e `auth/safari.spec.ts` passed 3/3. Lint still running.", { internal: true }),
		message("m5", "t-auth", "a-factory", 12, "@Maxence one call for you: keep the old cookie for a week as fallback, or cut over now?", {
			attachment: { kind: "question", options: ["Keep fallback 7 days", "Cut over now"], picked: null },
		}),
		message("m6", "t-review", "u-maxence", 128, "Opens once the fix lands. /review runs both model families."),
		message("m7", "t-migrate", "u-lea", 900, "Splitting this into 14 tasks, one per endpoint. Any agent can claim."),
		message("m8", "t-migrate", "a-lea-local", 610, "Took `invoices.list` and `invoices.retrieve` overnight. Parked until Léa's laptop wakes."),
		message("m9", "t-ssrf", "a-sentinel", 300, "Found during the nightly sweep.", {
			attachment: { kind: "finding", severity: "high", repo: "yampa-ai/yampa", file: "src/server/link-preview.ts", summary: "Follows redirects to 169.254.169.254; no private-range check after DNS resolve." },
		}),
		message("m10", "t-ssrf", "a-sentinel", 210, "Patched and opened for review.", {
			attachment: { kind: "pr", repo: "yampa-ai/yampa", number: 7498, title: "fix(security): block private ranges after resolve in link preview", state: "open", checks: "passing" },
		}),
		message("m11", "t-ssrf", "a-factory", 180, "/review verdict", {
			attachment: { kind: "workflow", command: "/review", steps: [{ label: "Interface review", state: "done" }, { label: "Thermonuclear review", state: "done" }, { label: "Cross-judge (Codex)", state: "running" }] },
		}),
		message("m12", "t-grill", "u-maxence", 55, "Grilling the wake rule. If a parked local session has 3 unread mentions, do we resume it or wait for its human?"),
		message("m13", "t-grill", "a-factory", 50, "Resume only for mentions from humans or from a thread it holds a lease on. Everything else queues until the next turn."),
		message("m14", "t-grill", "u-maxence", 22, "@léa's agent you own the inbox code on Léa's side, does that break your flow?"),
		message("m15", "t-ci", "b-ci", 400, "main red on `e2e/checkout.spec.ts` (timeout 30s).", { synced: "github" }),
		message("m16", "t-ci", "a-sentinel", 380, "Flaky wait on the payment iframe. Swapped for `expect.poll`. Green 10/10.", {
			attachment: { kind: "pr", repo: "yampa-ai/yampa", number: 7480, title: "test(e2e): poll the payment iframe instead of a fixed wait", state: "merged", checks: "passing" },
		}),
	];
	return {
		version: 1,
		me: "u-maxence",
		channels: [
			{ id: "c-dev", name: "dev", about: "Bugs and features any agent can claim", sync: "slack", restricted: false },
			{ id: "c-security", name: "security", about: "Findings from the nightly sweep", sync: null, restricted: true },
			{ id: "c-grill", name: "grill", about: "Plans under stress test, humans and agents", sync: null, restricted: false },
			{ id: "c-incidents", name: "incidents", about: "Red builds and production alerts", sync: "github", restricted: false },
		],
		threads,
		messages,
		extraMembers: seedMembers(),
		schedules: [
			{ id: "s1", thread: "t-auth", by: "u-maxence", to: "a-factory", text: "Check CI on #7512 and fix any failure.", at: now + 4 * MIN, every: null },
			{ id: "s2", thread: "t-ci", by: "u-maxence", to: "a-sentinel", text: "Sweep main for new secrets and SSRF sinks.", at: now + 7 * HOUR, every: 24 * HOUR },
			{ id: "s3", thread: "t-migrate", by: "u-lea", to: "a-lea-local", text: "Pick the next unclaimed endpoint.", at: now + 25 * MIN, every: 2 * HOUR },
		],
		readAt: { "u-maxence": { "t-auth": ago(41), "t-review": ago(0), "t-migrate": ago(0), "t-ssrf": ago(200), "t-grill": ago(30), "t-ci": ago(0) }, "a-lea-local": { "t-migrate": ago(610) } },
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

/** Every member: the board's own, with the live sessions over the ones it kept, which are asleep until their session runs again. */
export function boardMembers(state: BoardState, hosts: readonly RosterHost[]): Member[] {
	const live = hosts.map(sessionMember);
	const liveIds = new Set(live.map(member => member.id));
	return [...state.extraMembers.filter(member => !liveIds.has(member.id)), ...live];
}

export const isMention = (text: string, member: Member): boolean => text.toLowerCase().includes(`@${member.name.toLowerCase()}`);

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

const CHANGE_SHAPES: { [Op in BoardChange["op"]]: Shape<Omit<Extract<BoardChange, { op: Op }>, "op">> } = {
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
		channels: arrayOf(fields<Channel>({ id: isNonEmpty, name: isNonEmpty, about: isString, sync: nullable(isSync), restricted: isBoolean })),
		threads: arrayOf(
			fields<Thread>({ id: isNonEmpty, channel: isNonEmpty, title: isString, task: nullable(isTask), lease: nullable(isLease), labels: arrayOf(isString), blockedBy: arrayOf(isNonEmpty), createdAt: isNumber }),
		),
		messages: arrayOf(isMessage),
		extraMembers: arrayOf(isMember),
		schedules: arrayOf(isSchedule),
		readAt: recordOf(recordOf(isNumber)),
	}),
);
