// The Board's event log and what it reads as: the dashboard server appends one event per line to
// `board-events.jsonl` in its config directory, and both the server and the `board` tool fold those lines into
// Board tasks. The kit cannot import the dashboard's `src/`, so the dashboard imports this file instead: one copy
// of the event shapes, the checks, and the fold. It imports nothing, so it runs in either place.

/** How long a claim holds a Board task before the dashboard's sweep returns it to ready, unless it is renewed. */
export const LEASE_MS = 15 * 60_000;
/** The longest title, reply, body, and label a Board change takes. */
export const MAX_TITLE = 200;
export const MAX_TEXT = 8000;
export const MAX_LABELS = 12;

/** Who wrote a Board task or a reply: the user on the Board page, or a top-level session through the `board` tool. */
export type BoardAuthor = { kind: "user" } | { kind: "session"; sessionId: string };

/** How the session started on a Board task runs, as the page's composer picked it: its model, thinking level, and skill; `null` for omp's default. */
export interface BoardLaunch {
	model: { provider: string; id: string } | null;
	thinking: string | null;
	skill: string | null;
}

/**
 * What the page and the `board` tool ask for. The server stamps each with the time, and a post with its number,
 * then appends it to the log. `start`, `woke`, and `expire` come only from the server itself: auto-start, the wake
 * path, and the lease sweep.
 */
export type BoardChange =
	| { op: "post"; by: BoardAuthor; workspace: string; title: string; text?: string; labels?: Record<string, string>; needs?: number[]; launch?: BoardLaunch }
	| { op: "reply"; by: BoardAuthor; task: number; text: string; launch?: BoardLaunch }
	| { op: "claim"; sessionId: string; task: number }
	| { op: "renew"; sessionId: string; task: number }
	| { op: "done"; sessionId: string; task: number; text?: string }
	| { op: "start"; task: number; sessionId: string | null; error?: string }
	| { op: "woke"; task: number; sessionId: string }
	| { op: "expire"; task: number };

/** One line of the log: a change with when it happened, and a post with the number it took. */
export type BoardEvent = BoardChange & { at: number; id?: number };

/** A session's claim on a Board task, which lapses at `until` unless renewed. */
export interface BoardClaim {
	sessionId: string;
	at: number;
	until: number;
}

/** The session auto-start opened on a Board task since it last became ready; `sessionId` is `null` when the start failed. */
export interface BoardStart {
	sessionId: string | null;
	at: number;
}

/** A grey line of a Board thread, which the Board writes, not a person or a session. */
export type BoardNote =
	| { kind: "started"; sessionId: string }
	| { kind: "start-failed"; error: string }
	| { kind: "claimed"; sessionId: string }
	| { kind: "renewed"; sessionId: string }
	| { kind: "expired"; sessionId: string }
	| { kind: "unclaimed"; sessionId: string | null }
	| { kind: "ready"; task: number }
	| { kind: "woke"; sessionId: string }
	| { kind: "done"; sessionId: string };

/** A reply keeps the model, thinking level, and skill picked for the session it wakes, which a session's own reply leaves out. */
export type BoardReply = { at: number; by: BoardAuthor; text: string; launch?: BoardLaunch } | { at: number; note: BoardNote };

export interface BoardTask {
	id: number;
	/** The Workspace the Board task belongs to: a repository's main checkout, or a directory outside git. */
	workspace: string;
	by: BoardAuthor;
	at: number;
	title: string;
	text: string;
	labels: Record<string, string>;
	/** The Board tasks that must be done before this one is ready. */
	needs: number[];
	/** How its session starts, `null` for omp's defaults. */
	launch: BoardLaunch | null;
	claim: BoardClaim | null;
	start: BoardStart | null;
	doneAt: number | null;
	replies: BoardReply[];
}

export interface BoardState {
	tasks: BoardTask[];
	/** The number the next post takes. */
	nextId: number;
}

export type BoardStatus = { kind: "done" } | { kind: "claimed"; sessionId: string; until: number } | { kind: "waiting"; on: number } | { kind: "ready" };

export const emptyBoard = (): BoardState => ({ tasks: [], nextId: 1 });

const findTask = (state: BoardState, id: number): BoardTask | undefined => state.tasks.find(task => task.id === id);

/** Where Board task `task` stands: done, claimed, waiting on the first Board task it needs that is not done, or ready. */
export function statusOf(state: BoardState, task: BoardTask): BoardStatus {
	if (task.doneAt !== null) return { kind: "done" };
	if (task.claim) return { kind: "claimed", sessionId: task.claim.sessionId, until: task.claim.until };
	const on = task.needs.find(id => findTask(state, id)?.doneAt === null);
	return on === undefined ? { kind: "ready" } : { kind: "waiting", on };
}

/** The Board tasks that are ready and have no session started on them: auto-start opens one session on each. */
export const unstartedReady = (state: BoardState): BoardTask[] => state.tasks.filter(task => task.start === null && statusOf(state, task).kind === "ready");

/** The Board tasks whose lease, or whose start's unclaimed wait, ran out by `now`. */
export const lapsed = (state: BoardState, now: number): BoardTask[] =>
	state.tasks.filter(task => task.doneAt === null && (task.claim ? task.claim.until <= now : task.start !== null && task.start.at + LEASE_MS <= now));

/**
 * The session a reply on `task` by `by` wakes: the claimer; on a done Board task, the session that marked it done;
 * else the session started on it, else the thread's author when a session wrote it; never the replier itself.
 */
export function wakeTarget(task: BoardTask, by: BoardAuthor): string | null {
	let finisher: string | null = null;
	for (const entry of task.replies) if ("note" in entry && entry.note.kind === "done") finisher = entry.note.sessionId;
	const target = task.claim?.sessionId ?? (task.doneAt !== null ? finisher : null) ?? task.start?.sessionId ?? (task.by.kind === "session" ? task.by.sessionId : null);
	return target !== null && !(by.kind === "session" && by.sessionId === target) ? target : null;
}

/** The text of `change` an event keeps, on one line for a title, trimmed for a body. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Why `state` refuses `change`, or `null` when it takes it. */
export function refusal(state: BoardState, change: BoardChange, now: number): string | null {
	if (change.op === "post") {
		if (!oneLine(change.title)) return "A Board task needs a title.";
		if (!change.workspace.trim()) return "A Board task needs a workspace.";
		for (const id of change.needs ?? []) if (!findTask(state, id)) return `There is no Board task #${id} to wait on.`;
		return null;
	}
	const task = findTask(state, change.task);
	if (!task) return `There is no Board task #${change.task}.`;
	const status = statusOf(state, task);
	switch (change.op) {
		case "reply":
			return change.text.trim() ? null : "A reply needs text.";
		case "claim":
			if (status.kind === "done") return `Board task #${task.id} is done.`;
			if (status.kind === "waiting") return `Board task #${task.id} waits on #${status.on}, which is not done.`;
			if (status.kind === "claimed") return status.sessionId === change.sessionId ? null : `Board task #${task.id} is claimed by session ${status.sessionId} for ${Math.max(0, Math.ceil((status.until - now) / 60_000))} more minutes.`;
			return null;
		case "renew":
		case "done":
			if (status.kind === "done") return `Board task #${task.id} is done.`;
			return status.kind === "claimed" && status.sessionId === change.sessionId ? null : `This session holds no claim on Board task #${task.id}; claim it first.`;
		case "start":
		case "woke":
			return null;
		case "expire":
			return status.kind === "done" ? `Board task #${task.id} is done.` : null;
	}
}

/** `state` with `event` folded in; the event was checked with {@link refusal} before it was appended. */
export function fold(state: BoardState, event: BoardEvent): BoardState {
	const { at } = event;
	if (event.op === "post") {
		const id = event.id ?? state.nextId;
		const task: BoardTask = {
			id,
			workspace: event.workspace,
			by: event.by,
			at,
			title: oneLine(event.title),
			text: event.text?.trim() ?? "",
			labels: event.labels ?? {},
			needs: event.needs ?? [],
			launch: event.launch ?? null,
			claim: null,
			start: null,
			doneAt: null,
			replies: [],
		};
		return { tasks: [...state.tasks, task], nextId: Math.max(state.nextId, id + 1) };
	}
	const edit = (id: number, change: (task: BoardTask) => BoardTask, tasks = state.tasks): BoardTask[] => tasks.map(task => (task.id === id ? change(task) : task));
	const note = (task: BoardTask, note: BoardNote): BoardTask => ({ ...task, replies: [...task.replies, { at, note }] });
	switch (event.op) {
		case "reply":
			return { ...state, tasks: edit(event.task, task => ({ ...task, replies: [...task.replies, { at, by: event.by, text: event.text.trim(), ...(event.launch ? { launch: event.launch } : {}) }] })) };
		case "claim":
			return { ...state, tasks: edit(event.task, task => note({ ...task, claim: { sessionId: event.sessionId, at, until: at + LEASE_MS } }, { kind: "claimed", sessionId: event.sessionId })) };
		case "renew":
			return { ...state, tasks: edit(event.task, task => note({ ...task, claim: task.claim && { ...task.claim, until: at + LEASE_MS } }, { kind: "renewed", sessionId: event.sessionId })) };
		case "done": {
			const tasks = edit(event.task, task => {
				const closed = note({ ...task, claim: null, doneAt: at }, { kind: "done", sessionId: event.sessionId });
				return event.text?.trim() ? { ...closed, replies: [...closed.replies, { at, by: { kind: "session", sessionId: event.sessionId }, text: event.text.trim() }] } : closed;
			});
			const after = { ...state, tasks };
			// Each Board task this one held back, and that waits on nothing else now, gets a line saying it is ready.
			return { ...after, tasks: tasks.map(task => (task.needs.includes(event.task) && task.doneAt === null && !task.claim && statusOf(after, task).kind === "ready" ? note(task, { kind: "ready", task: event.task }) : task)) };
		}
		case "start":
			return {
				...state,
				tasks: edit(event.task, task => note({ ...task, start: { sessionId: event.sessionId, at } }, event.sessionId === null ? { kind: "start-failed", error: event.error ?? "It did not start." } : { kind: "started", sessionId: event.sessionId })),
			};
		case "woke":
			return { ...state, tasks: edit(event.task, task => note(task, { kind: "woke", sessionId: event.sessionId })) };
		case "expire":
			return { ...state, tasks: edit(event.task, task => note({ ...task, claim: null, start: null }, task.claim ? { kind: "expired", sessionId: task.claim.sessionId } : { kind: "unclaimed", sessionId: task.start?.sessionId ?? null })) };
	}
}

/** `state` with `change` applied at `now`, as the server appends it, or why it refuses. */
export function applyChange(state: BoardState, change: BoardChange, now: number): { ok: BoardState; event: BoardEvent } | { error: string } {
	const refused = refusal(state, change, now);
	if (refused !== null) return { error: refused };
	const event: BoardEvent = change.op === "post" ? { ...change, at: now, id: state.nextId } : { ...change, at: now };
	return { ok: fold(state, event), event };
}

/** The Board the log's text reads as; a line that is no event is skipped, as a half-written last line is. */
export function readLog(text: string): BoardState {
	let state = emptyBoard();
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		const event = parseEvent(value);
		if (event) state = fold(state, event);
	}
	return state;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function parseAuthor(value: unknown): BoardAuthor | null {
	if (!isRecord(value)) return null;
	if (value.kind === "user") return { kind: "user" };
	return value.kind === "session" && isText(value.sessionId, 200) && value.sessionId ? { kind: "session", sessionId: value.sessionId } : null;
}

function parseLabels(value: unknown): Record<string, string> | null {
	if (value === undefined) return {};
	if (!isRecord(value)) return null;
	const entries = Object.entries(value);
	if (entries.length > MAX_LABELS || !entries.every(([key, text]) => key.length > 0 && key.length <= 40 && isText(text, 80))) return null;
	return Object.fromEntries(entries) as Record<string, string>;
}

/** A text of a launch: `null` when absent, `false` when it is no such text. */
const launchText = (value: unknown): string | null | false => (value === null || value === undefined ? null : isText(value, 200) && value ? value : false);

/** The launch `value` holds: `undefined` for none, `null` for anything but a launch. */
function parseLaunch(value: unknown): BoardLaunch | undefined | null {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	const { model } = value;
	const thinking = launchText(value.thinking);
	const skill = launchText(value.skill);
	const picked = model === null || model === undefined ? null : isRecord(model) && isText(model.provider, 200) && isText(model.id, 200) && model.provider && model.id ? { provider: model.provider, id: model.id } : false;
	return thinking === false || skill === false || picked === false ? null : { model: picked, thinking, skill };
}

/** The change `value` holds, or `null` when it holds none; `server` admits the changes only the server makes. */
export function parseChange(value: unknown, server = true): BoardChange | null {
	if (!isRecord(value)) return null;
	switch (value.op) {
		case "post": {
			const by = parseAuthor(value.by);
			const labels = parseLabels(value.labels);
			const needs = value.needs === undefined ? [] : Array.isArray(value.needs) && value.needs.length <= 20 && value.needs.every(isId) ? (value.needs as number[]) : null;
			const launch = parseLaunch(value.launch);
			if (!by || !labels || !needs || launch === null || !isText(value.workspace, 4096) || !isText(value.title, MAX_TITLE) || (value.text !== undefined && !isText(value.text, MAX_TEXT))) return null;
			return { op: "post", by, workspace: value.workspace, title: value.title, ...(typeof value.text === "string" && value.text.trim() ? { text: value.text } : {}), ...(Object.keys(labels).length ? { labels } : {}), ...(needs.length ? { needs } : {}), ...(launch ? { launch } : {}) };
		}
		case "reply": {
			const by = parseAuthor(value.by);
			const launch = parseLaunch(value.launch);
			return by && launch !== null && isId(value.task) && isText(value.text, MAX_TEXT) ? { op: "reply", by, task: value.task, text: value.text, ...(launch ? { launch } : {}) } : null;
		}
		case "claim":
		case "renew":
			return isId(value.task) && isText(value.sessionId, 200) && value.sessionId ? { op: value.op, task: value.task, sessionId: value.sessionId } : null;
		case "done":
			return isId(value.task) && isText(value.sessionId, 200) && value.sessionId && (value.text === undefined || isText(value.text, MAX_TEXT))
				? { op: "done", task: value.task, sessionId: value.sessionId, ...(typeof value.text === "string" ? { text: value.text } : {}) }
				: null;
		case "start":
			if (!server || !isId(value.task) || !(value.sessionId === null || isText(value.sessionId, 200))) return null;
			return { op: "start", task: value.task, sessionId: value.sessionId as string | null, ...(typeof value.error === "string" ? { error: value.error } : {}) };
		case "woke":
			return server && isId(value.task) && isText(value.sessionId, 200) ? { op: "woke", task: value.task, sessionId: value.sessionId } : null;
		case "expire":
			return server && isId(value.task) ? { op: "expire", task: value.task } : null;
		default:
			return null;
	}
}

/** The event one log line holds, or `null`. */
function parseEvent(value: unknown): BoardEvent | null {
	if (!isRecord(value) || typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
	const change = parseChange(value);
	if (!change) return null;
	return change.op === "post" && isId(value.id) ? { ...change, at: value.at, id: value.id } : { ...change, at: value.at };
}
