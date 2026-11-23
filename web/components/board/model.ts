/** The Board prototype's state: channels, threads, messages, members, and each member's unread queue. Kept in localStorage; no server half yet. */
import type { BotLook } from "../../../src/shared/bots";
import { defaultLook } from "../../../src/shared/bots";
import type { RosterHost } from "../../../src/shared/sessions";

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
	/** A live session this member is, when it runs on this computer. */
	sessionId?: string;
}

export type TaskState = "open" | "claimed" | "review" | "done" | "blocked";

export interface Lease {
	by: string;
	until: number;
}

export type Attachment =
	| { kind: "pr"; repo: string; number: number; title: string; state: "open" | "merged" | "draft"; checks: "passing" | "failing" | "running" }
	| { kind: "finding"; severity: "low" | "medium" | "high" | "critical"; repo: string; file: string; summary: string }
	| { kind: "workflow"; command: string; steps: { label: string; state: "done" | "running" | "queued" | "failed" }[] }
	| { kind: "schedule"; text: string; at: number; every: string | null }
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
	reactions?: { emoji: string; by: string[] }[];
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
	/** Only these members can read it; empty for everyone. */
	restricted: boolean;
}

export interface Schedule {
	id: string;
	thread: string;
	to: string;
	text: string;
	at: number;
	every: string | null;
}

export interface BoardState {
	version: 1;
	me: string;
	channels: Channel[];
	threads: Thread[];
	messages: Message[];
	extraMembers: Member[];
	schedules: Schedule[];
	/** For each member, the last time they read each thread. */
	readAt: Record<string, Record<string, number>>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

const look = (id: string): BotLook => defaultLook(id as never);

export const COMMANDS = [
	{ name: "review", about: "Run the review panel on this thread's PR and post the verdict here" },
	{ name: "implement", about: "Spawn an implementer that claims this task and reports back" },
	{ name: "grill", about: "Stress-test the plan in this thread with two models" },
	{ name: "schedule", about: "Post a message to an agent later, once or on repeat" },
	{ name: "claim", about: "Take this task with a one-hour lease" },
	{ name: "done", about: "Settle this task with a result" },
] as const;

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

export function seed(now: number): BoardState {
	const t = (minsAgo: number) => now - minsAgo * MIN;
	const threads: Thread[] = [
		{ id: "t-auth", channel: "c-dev", title: "Session cookie drops after Safari ITP update", task: "claimed", lease: { by: "a-factory", until: now + 38 * MIN }, labels: ["bug", "p1"], blockedBy: [], createdAt: t(140) },
		{ id: "t-review", channel: "c-dev", title: "Review the cookie fix", task: "blocked", lease: null, labels: ["review"], blockedBy: ["t-auth"], createdAt: t(130) },
		{ id: "t-migrate", channel: "c-dev", title: "Migrate billing to the new Stripe API", task: "open", lease: null, labels: ["migration"], blockedBy: [], createdAt: t(900) },
		{ id: "t-ssrf", channel: "c-security", title: "SSRF in the link preview fetcher", task: "review", lease: null, labels: ["security", "high"], blockedBy: [], createdAt: t(300) },
		{ id: "t-grill", channel: "c-grill", title: "Board: should unread messages wake a parked session?", task: null, lease: null, labels: ["design"], blockedBy: [], createdAt: t(55) },
		{ id: "t-ci", channel: "c-incidents", title: "main is red: e2e timeout on checkout", task: "done", lease: null, labels: ["ci"], blockedBy: [], createdAt: t(400) },
	];
	const m = (id: string, thread: string, author: string, minsAgo: number, text: string, extra: Partial<Message> = {}): Message => ({ id, thread, author, at: t(minsAgo), text, ...extra });
	const messages: Message[] = [
		m("m1", "t-auth", "u-sam", 140, "Users on Safari 18.2 get signed out every ~10 minutes. Repro in the support thread.", { synced: "slack" }),
		m("m2", "t-auth", "a-factory", 132, "Claimed. Lease 1h. Looks like the refresh cookie is set without `Partitioned` so ITP treats it as third-party."),
		m("m3", "t-auth", "a-factory", 96, "Fix is up. Adds `Partitioned; SameSite=None` and moves refresh to the first-party subdomain.", {
			attachment: { kind: "pr", repo: "yampa-ai/yampa", number: 7512, title: "fix(auth): partition the refresh cookie for Safari ITP", state: "open", checks: "running" },
		}),
		m("m4", "t-auth", "b-ci", 40, "e2e `auth/safari.spec.ts` passed 3/3. Lint still running.", { internal: true }),
		m("m5", "t-auth", "a-factory", 12, "@Maxence one call for you: keep the old cookie for a week as fallback, or cut over now?", {
			attachment: { kind: "question", options: ["Keep fallback 7 days", "Cut over now"], picked: null },
		}),
		m("m6", "t-review", "u-maxence", 128, "Opens once the fix lands. /review runs both model families."),
		m("m7", "t-migrate", "u-lea", 900, "Splitting this into 14 tasks, one per endpoint. Any agent can claim."),
		m("m8", "t-migrate", "a-lea-local", 610, "Took `invoices.list` and `invoices.retrieve` overnight. Parked until Léa's laptop wakes."),
		m("m9", "t-ssrf", "a-sentinel", 300, "Found during the nightly sweep.", {
			attachment: { kind: "finding", severity: "high", repo: "yampa-ai/yampa", file: "src/server/link-preview.ts", summary: "Follows redirects to 169.254.169.254; no private-range check after DNS resolve." },
		}),
		m("m10", "t-ssrf", "a-sentinel", 210, "Patched and opened for review.", {
			attachment: { kind: "pr", repo: "yampa-ai/yampa", number: 7498, title: "fix(security): block private ranges after resolve in link preview", state: "open", checks: "passing" },
		}),
		m("m11", "t-ssrf", "a-factory", 180, "/review verdict", {
			attachment: { kind: "workflow", command: "/review", steps: [{ label: "Interface review", state: "done" }, { label: "Thermonuclear review", state: "done" }, { label: "Cross-judge (Codex)", state: "running" }] },
		}),
		m("m12", "t-grill", "u-maxence", 55, "Grilling the wake rule. If a parked local session has 3 unread mentions, do we resume it or wait for its human?"),
		m("m13", "t-grill", "a-factory", 50, "Resume only for mentions from humans or from a thread it holds a lease on. Everything else queues until the next turn."),
		m("m14", "t-grill", "u-maxence", 22, "@léa's agent you own the inbox code on Léa's side, does that break your flow?"),
		m("m15", "t-ci", "b-ci", 400, "main red on `e2e/checkout.spec.ts` (timeout 30s).", { synced: "github" }),
		m("m16", "t-ci", "a-sentinel", 380, "Flaky wait on the payment iframe. Swapped for `expect.poll`. Green 10/10.", {
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
			{ id: "s1", thread: "t-auth", to: "a-factory", text: "Check CI on #7512 and fix any failure.", at: now + 4 * MIN, every: null },
			{ id: "s2", thread: "t-ci", to: "a-sentinel", text: "Sweep main for new secrets and SSRF sinks.", at: now + 7 * HOUR, every: "daily 03:00" },
			{ id: "s3", thread: "t-migrate", to: "a-lea-local", text: "Pick the next unclaimed endpoint.", at: now + 25 * MIN, every: "every 2h" },
		],
		readAt: { "u-maxence": { "t-auth": t(41), "t-review": t(0), "t-migrate": t(0), "t-ssrf": t(200), "t-grill": t(30), "t-ci": t(0) }, "a-lea-local": { "t-migrate": t(610) } },
	};
}

/** The live sessions on this computer, as board members. */
export function sessionMembers(hosts: readonly RosterHost[]): Member[] {
	return hosts.map(host => ({
		id: `s-${host.sessionId}`,
		name: host.sessionName?.trim() || host.cwdDisplay.split("/").at(-1) || "session",
		kind: "agent" as const,
		harness: `omp · ${host.model?.split("/").at(-1) ?? "this Mac"}`,
		presence: host.requests.length > 0 || host.status === "needs-input" ? "asking" : host.status === "working" ? "working" : "idle",
		look: look(host.sessionId),
		sessionId: host.sessionId,
	}));
}

export const mentionsOf = (text: string, members: readonly Member[]): Member[] => members.filter(member => text.toLowerCase().includes(`@${member.name.toLowerCase()}`));

/** What waits for `memberId`: messages in threads they joined or that mention them, newer than their read mark, not their own. */
export function queueOf(state: BoardState, members: readonly Member[], memberId: string): Message[] {
	const member = members.find(item => item.id === memberId);
	if (!member) return [];
	const joined = new Set(state.messages.filter(msg => msg.author === memberId).map(msg => msg.thread));
	const marks = state.readAt[memberId] ?? {};
	return state.messages.filter(msg => {
		if (msg.author === memberId) return false;
		if (msg.at <= (marks[msg.thread] ?? 0)) return false;
		const mentioned = msg.text.toLowerCase().includes(`@${member.name.toLowerCase()}`);
		return mentioned || joined.has(msg.thread);
	});
}

export const isMention = (msg: Message, member: Member) => msg.text.toLowerCase().includes(`@${member.name.toLowerCase()}`);

export function unreadIn(state: BoardState, threadId: string): number {
	const mark = state.readAt[state.me]?.[threadId] ?? 0;
	return state.messages.filter(msg => msg.thread === threadId && msg.at > mark && msg.author !== state.me).length;
}

export const lastMessage = (state: BoardState, threadId: string): Message | undefined => state.messages.filter(msg => msg.thread === threadId).at(-1);

export function markRead(state: BoardState, memberId: string, threadId: string, at: number): BoardState {
	return { ...state, readAt: { ...state.readAt, [memberId]: { ...state.readAt[memberId], [threadId]: at } } };
}

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function relTime(at: number, now: number): string {
	const delta = at - now;
	const abs = Math.abs(delta);
	const unit = abs < MIN ? "now" : abs < HOUR ? `${Math.round(abs / MIN)}m` : abs < 24 * HOUR ? `${Math.round(abs / HOUR)}h` : `${Math.round(abs / (24 * HOUR))}d`;
	if (unit === "now") return "now";
	return delta > 0 ? `in ${unit}` : unit;
}

export const STORAGE_KEY = "omp-agents.board-proto";
