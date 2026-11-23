// What the `project` extension reads of the dashboard's board, and the brief a session in a project gets.
// The kit cannot import the dashboard's `src/`, so this keeps its own copy of the few fields of `board.json` it reads;
// `templates/omp/project-board-brief.test.ts` fails when they drift from `src/shared/board.ts`.
// A project is a board channel carrying `project`; its task threads are its plan, and its messages its log.

export interface BoardProject {
	goal: string;
	decisions: string[];
	sessionIds: string[];
	archivedAt?: number;
}

export interface BoardChannel {
	id: string;
	name: string;
	project?: BoardProject;
}

export interface BoardThread {
	id: string;
	channel: string;
	title: string;
	task: "open" | "claimed" | "review" | "done" | null;
	createdAt: number;
	parent?: string;
}

export interface BoardMessage {
	thread: string;
	author: string;
	at: number;
	text: string;
}

export interface Board {
	channels: BoardChannel[];
	threads: BoardThread[];
	messages: BoardMessage[];
}

/** The log lines a brief shows, the newest ones. */
export const BRIEF_LOG_LINES = 10;

/** A session's feed thread, which the brief's log leaves out. */
const FEED_PREFIX = "t-session-";

/** What `board.json` holds, as far as the brief reads it; an empty board for a missing or malformed file. */
export function boardIn(file: unknown): Board {
	const raw = file as Partial<Record<keyof Board, unknown>> | null;
	const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
	return { channels: list(raw?.channels), threads: list(raw?.threads), messages: list(raw?.messages) };
}

/** The open project channel session `sessionId` is in. */
export const projectOfSession = (board: Board, sessionId: string): (BoardChannel & { project: BoardProject }) | null =>
	(board.channels.find(channel => channel.project && channel.project.archivedAt === undefined && channel.project.sessionIds?.includes(sessionId)) as
		| (BoardChannel & { project: BoardProject })
		| undefined) ?? null;

/** The plan of `channelId`, ordered: each top-level step by creation, its sub-steps right after it. */
export function planOf(board: Board, channelId: string): BoardThread[] {
	const steps = board.threads.filter(thread => thread.channel === channelId && thread.task !== null).sort((a, b) => a.createdAt - b.createdAt);
	const ids = new Set(steps.map(step => step.id));
	const top = steps.filter(step => step.parent === undefined || !ids.has(step.parent));
	return top.flatMap(step => [step, ...steps.filter(sub => sub.parent === step.id)]);
}

/** Each step's number: `2` for the second top-level step, `2.1` for the first sub-step under it. */
export function stepNumbers(plan: readonly BoardThread[]): Map<string, string> {
	const numbers = new Map<string, string>();
	const subs = new Map<string, number>();
	let top = 0;
	for (const step of plan) {
		const parent = step.parent !== undefined ? numbers.get(step.parent) : undefined;
		if (parent === undefined) {
			top += 1;
			numbers.set(step.id, String(top));
			continue;
		}
		const count = (subs.get(step.parent!) ?? 0) + 1;
		subs.set(step.parent!, count);
		numbers.set(step.id, `${parent}.${count}`);
	}
	return numbers;
}

/** The brief session `sessionId` gets when it is in a project: its goal, plan, decisions, and newest log lines; null in none. */
export function briefText(board: Board, sessionId: string): string | null {
	const channel = projectOfSession(board, sessionId);
	if (!channel) return null;
	const { project } = channel;
	const lines = [`This session is part of the project "${channel.name}" (board channel ${channel.id}), which other sessions work on too.`];
	lines.push(`Goal: ${project.goal?.trim() || "not set yet"}`);
	const plan = planOf(board, channel.id);
	if (plan.length > 0) {
		const numbers = stepNumbers(plan);
		const nested = plan.some(step => numbers.get(step.id)!.includes(".")) ? "; a step numbered like 2.1 is a sub-step of step 2" : "";
		lines.push("", `Plan (${plan.filter(step => step.task === "done").length} of ${plan.length} done${nested}):`);
		lines.push(...plan.map(step => {
			const number = numbers.get(step.id)!;
			return `${number.includes(".") ? "   " : ""}${number}. [${step.task === "done" ? "x" : " "}] ${step.title}`;
		}));
	} else lines.push("", "Plan: no steps yet.");
	const decisions = project.decisions ?? [];
	if (decisions.length > 0) lines.push("", "Decisions:", ...decisions.map((decision, index) => `${index + 1}. ${decision}`));
	const threads = new Set(board.threads.filter(thread => thread.channel === channel.id && !thread.id.startsWith(FEED_PREFIX)).map(thread => thread.id));
	const log = board.messages.filter(message => threads.has(message.thread)).sort((a, b) => a.at - b.at);
	const recent = log.slice(-BRIEF_LOG_LINES);
	if (recent.length > 0) {
		lines.push("", `Latest messages, oldest first${log.length > recent.length ? ` (the last ${recent.length} of ${log.length})` : ""}:`);
		lines.push(...recent.map(message => `- ${new Date(message.at).toISOString().slice(0, 10)} ${message.author === sessionId ? "this session" : message.author}: ${message.text.replace(/\s+/g, " ").trim()}`));
	}
	lines.push(
		"",
		"Work toward the goal. When you finish a step, mark its task done with the board tool's done action and post one line on what you did; record a decision the user settles with its decide action. Add a step with its step action only for work the plan is missing.",
	);
	return lines.join("\n");
}
