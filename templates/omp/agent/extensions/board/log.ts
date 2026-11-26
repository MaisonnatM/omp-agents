// The Board's event log and what it reads as: the dashboard server appends one event per line to
// `board-events.jsonl` in its config directory, and both the server and the `board` tool fold those lines into
// Board tasks. The kit cannot import the dashboard's `src/`, so the dashboard imports this file instead: one copy
// of the event shapes, the checks, and the fold. It imports nothing, so it runs in either place.

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
 * then appends it to the log. `start`, `woke`, `expire`, and `land` come only from the server itself: auto-start, the
 * wake path, a session that exited without marking its Board task done, and the merge it runs for a bare "Merge on main".
 * `close` comes only from the user on the page. `request` names the inbox file a `board` tool change came in, so the
 * same file applied again after a crash changes nothing.
 */
export type BoardChange = (
	| { op: "post"; by: BoardAuthor; workspace: string; title: string; text?: string; labels?: Record<string, string>; needs?: number[]; launch?: BoardLaunch }
	| { op: "reply"; by: BoardAuthor; task: number; text: string; launch?: BoardLaunch }
	| { op: "edit"; by: BoardAuthor; task: number; reply?: number; text: string }
	| { op: "close"; by: { kind: "user" }; task: number }
	| { op: "claim"; sessionId: string; task: number }
	| { op: "done"; sessionId: string; task: number; text?: string }
	| { op: "start"; task: number; sessionId: string | null; error?: string; branch?: string }
	| { op: "woke"; task: number; sessionId: string }
	| { op: "expire"; task: number }
	| { op: "land"; task: number; outcome: LandOutcome; text: string }
) & { request?: string };

/** How a merge the server ran for "Merge on main" went: it landed, it failed and reopens the Board task, or it was refused, as where the repository has no land config, which keeps the Board task done. */
export type LandOutcome = "landed" | "failed" | "refused";

/** One line of the log: a change with when it happened, and a post with the number it took. */
export type BoardEvent = BoardChange & { at: number; id?: number };

/** An interactive session's claim on a Board task, which holds it until the session marks it done or exits. */
export interface BoardClaim {
	sessionId: string;
	at: number;
}

/** The session auto-start opened on a Board task since it last became ready, which owns it, or why the last start failed. */
export type BoardStart = { sessionId: string; at: number } | { sessionId: null; at: number; error: string };

/** A grey line of a Board thread, which the Board writes, not a person or a session. */
export type BoardNote =
	| { kind: "started"; sessionId: string; branch?: string }
	| { kind: "start-failed"; error: string }
	| { kind: "claimed"; sessionId: string }
	| { kind: "expired"; sessionId: string }
	| { kind: "unclaimed"; sessionId: string | null }
	| { kind: "woke"; sessionId: string }
	| { kind: "done"; sessionId: string }
	| { kind: "closed" }
	| { kind: "landed"; text: string }
	| { kind: "land-failed"; text: string }
	| { kind: "land-refused"; text: string };

/** A reply keeps the model, thinking level, and skill picked for the session it wakes, which a session's own reply leaves out. */
export type BoardReply = { at: number; by: BoardAuthor; text: string; launch?: BoardLaunch; editedAt?: number } | { at: number; note: BoardNote };

export interface BoardTask {
	id: number;
	/** The Workspace the Board task belongs to: a repository's main checkout, or a directory outside git. */
	workspace: string;
	by: BoardAuthor;
	at: number;
	title: string;
	text: string;
	/** When its author last edited its text. */
	editedAt?: number;
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
	/** The inbox files of the last {@link REQUESTS_KEPT} `board` tool changes, newest last. */
	requests: string[];
}

/**
 * How many applied inbox files the Board remembers. The inbox applies one file at a time and deletes it after, so a
 * crash leaves at most the last few applied ones behind.
 */
const REQUESTS_KEPT = 100;

/** How many sessions in a row may exit without marking a Board task done before the Board stops starting new ones on it. */
export const MAX_EXITS = 3;

export type BoardStatus = { kind: "done" } | { kind: "claimed"; sessionId: string } | { kind: "failed"; error: string } | { kind: "waiting"; on: number } | { kind: "ready" };

export const emptyBoard = (): BoardState => ({ tasks: [], nextId: 1, requests: [] });

const findTask = (state: BoardState, id: number): BoardTask | undefined => state.tasks.find(task => task.id === id);

/**
 * Where Board task `task` stands: done, held by the session that claimed it or was started on it, failed when its last
 * start failed, which a reply from the user retries, waiting on the first Board task it needs that is not done, or ready.
 */
export function statusOf(state: BoardState, task: BoardTask): BoardStatus {
	if (task.doneAt !== null) return { kind: "done" };
	const holder = holderOf(task);
	if (holder !== null) return { kind: "claimed", sessionId: holder };
	const { start } = task;
	if (start !== null && start.sessionId === null) return { kind: "failed", error: start.error };
	const on = task.needs.find(id => findTask(state, id)?.doneAt === null);
	return on === undefined ? { kind: "ready" } : { kind: "waiting", on };
}

/** The session that holds `task`: the one that claimed it, else the one started on it; `null` when none does. */
export const holderOf = (task: BoardTask): string | null => task.claim?.sessionId ?? task.start?.sessionId ?? null;

/** The Board tasks that are ready and have no session started on them: auto-start opens one session on each. */
export const unstartedReady = (state: BoardState): BoardTask[] => state.tasks.filter(task => task.start === null && statusOf(state, task).kind === "ready");

/** The branch the sessions on `task` work on, as the last start recorded it; `null` when none did, such as in a directory outside git. */
export const branchOf = (task: BoardTask): string | null => task.replies.flatMap(entry => ("note" in entry && entry.note.kind === "started" && entry.note.branch ? [entry.note.branch] : [])).at(-1) ?? null;

/** The reply that asks the server to merge a done Board task's branch, as the suggestion a session offers reads. */
export const MERGE_REPLY = "Merge on main";

/** Whether the user's reply `text` on done Board task `task` is a bare {@link MERGE_REPLY} the server lands itself, keeping the task done, rather than a request a new session takes. */
export const landsOnReply = (task: BoardTask, by: BoardAuthor, text: string): boolean =>
	task.doneAt !== null && by.kind === "user" && branchOf(task) !== null && text.trim().replace(/\.$/, "").toLowerCase() === MERGE_REPLY.toLowerCase();

/**
 * The session a reply on `task` by `by` wakes: the claimer, else the session started on it, else the thread's author
 * when a session wrote it; never the replier itself. A done Board task wakes nobody: a reply from the user reopens it,
 * and a new session starts on its thread, unless it is a bare {@link MERGE_REPLY}, which the server lands.
 */
export function wakeTarget(task: BoardTask, by: BoardAuthor): string | null {
	if (task.doneAt !== null) return null;
	const target = task.claim?.sessionId ?? task.start?.sessionId ?? (task.by.kind === "session" ? task.by.sessionId : null);
	return target !== null && !(by.kind === "session" && by.sessionId === target) ? target : null;
}

/** The sessions started on `task`, oldest first: one per round, since a reply on a done Board task starts a new one. */
export const startedOn = (task: BoardTask): string[] => task.replies.flatMap(entry => ("note" in entry && entry.note.kind === "started" ? [entry.note.sessionId] : []));

/** The text of `change` an event keeps, on one line for a title, trimmed for a body. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Why `state` refuses `change`, or `null` when it takes it. */
export function refusal(state: BoardState, change: BoardChange): string | null {
	if (change.op === "post") {
		if (!oneLine(change.title)) return "A Board task needs a title.";
		if (!/^(\/|[A-Za-z]:[\\/])/.test(change.workspace)) return "A Board task's workspace must be an absolute path.";
		for (const id of change.needs ?? []) if (!findTask(state, id)) return `There is no Board task #${id} to wait on.`;
		return null;
	}
	const task = findTask(state, change.task);
	if (!task) return `There is no Board task #${change.task}.`;
	const status = statusOf(state, task);
	switch (change.op) {
		case "reply":
			return change.text.trim() ? null : "A reply needs text.";
		case "edit": {
			if (!change.text.trim()) return "An edit needs text.";
			const message = change.reply === undefined ? task : task.replies[change.reply];
			return message && "by" in message && message.by.kind === "user" && change.by.kind === "user" ? null : "Only the user's own messages can be edited.";
		}
		case "close":
			return status.kind === "done" ? `Board task #${task.id} is done.` : null;
		case "claim":
			if (status.kind === "done") return `Board task #${task.id} is done.`;
			if (status.kind === "waiting") return `Board task #${task.id} waits on #${status.on}, which is not done.`;
			if (status.kind === "claimed") return status.sessionId === change.sessionId ? null : `Board task #${task.id} is held by session ${status.sessionId}.`;
			return null;
		case "done":
			if (status.kind === "done") return `Board task #${task.id} is done.`;
			return status.kind === "claimed" && status.sessionId === change.sessionId ? null : `This session holds no claim on Board task #${task.id}; claim it first.`;
		case "start":
			// A session that came up after its Board task was claimed, closed, or done would hold nothing.
			return task.start === null && status.kind === "ready" ? null : `Board task #${task.id} is not ready to start.`;
		case "woke":
		case "land":
			return null;
		case "expire":
			return status.kind === "done" ? `Board task #${task.id} is done.` : null;
	}
}

/** How many sessions in a row exited on `task` without marking it done, since the user last wrote on its thread or a session last finished it. */
function exitsInARow(task: BoardTask): number {
	let exits = 0;
	for (const entry of task.replies.toReversed()) {
		if ("by" in entry ? entry.by.kind === "user" : entry.note.kind === "done" || entry.note.kind === "closed") break;
		if ("note" in entry && entry.note.kind === "unclaimed" && entry.note.sessionId !== null) exits++;
	}
	return exits;
}

/** `state` with `event` folded in; the event was checked with {@link refusal} before it was appended. */
export function fold(state: BoardState, event: BoardEvent): BoardState {
	const folded = foldTasks(state, event);
	return event.request === undefined ? folded : { ...folded, requests: [...folded.requests, event.request].slice(-REQUESTS_KEPT) };
}

function foldTasks(state: BoardState, event: BoardEvent): BoardState {
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
		return { ...state, tasks: [...state.tasks, task], nextId: Math.max(state.nextId, id + 1) };
	}
	const edit = (id: number, change: (task: BoardTask) => BoardTask, tasks = state.tasks): BoardTask[] => tasks.map(task => (task.id === id ? change(task) : task));
	const note = (task: BoardTask, note: BoardNote): BoardTask => ({ ...task, replies: [...task.replies, { at, note }] });
	switch (event.op) {
		case "reply":
			return {
				...state,
				tasks: edit(event.task, task => {
					const replied = { ...task, replies: [...task.replies, { at, by: event.by, text: event.text.trim(), ...(event.launch ? { launch: event.launch } : {}) }] };
					if (landsOnReply(task, event.by, event.text)) return replied;
					// The user's reply on a done Board task, or on one whose session failed to start, reopens it, so a new session starts on its thread with the launch the reply picked.
					const reopens = event.by.kind === "user" && (task.doneAt !== null || task.start?.sessionId === null);
					return reopens ? { ...replied, doneAt: null, start: null, launch: event.launch ?? task.launch } : replied;
				}),
			};
		case "edit": {
			const text = event.text.trim();
			const { reply } = event;
			return {
				...state,
				tasks: edit(event.task, task => {
					if (reply !== undefined) return { ...task, replies: task.replies.map((entry, index) => (index === reply && "by" in entry ? { ...entry, text, editedAt: at } : entry)) };
					// An edited Board task takes its first line as its title, as the page's composer posts one.
					const title = oneLine(text.split("\n")[0] ?? "").slice(0, MAX_TITLE) || task.title;
					return { ...task, title, text, editedAt: at };
				}),
			};
		}
		case "close":
			// Closing keeps the start, so the runner ends the session started on it.
			return { ...state, tasks: edit(event.task, task => note({ ...task, claim: null, doneAt: at }, { kind: "closed" })) };
		case "claim":
			return { ...state, tasks: edit(event.task, task => note({ ...task, claim: { sessionId: event.sessionId, at } }, { kind: "claimed", sessionId: event.sessionId })) };
		case "done": {
			const tasks = edit(event.task, task => {
				const closed = note({ ...task, claim: null, doneAt: at }, { kind: "done", sessionId: event.sessionId });
				return event.text?.trim() ? { ...closed, replies: [...closed.replies, { at, by: { kind: "session", sessionId: event.sessionId }, text: event.text.trim() }] } : closed;
			});
			return { ...state, tasks };
		}
		case "start": {
			const { sessionId } = event;
			const error = event.error ?? "It did not start.";
			return {
				...state,
				tasks: edit(event.task, task =>
					sessionId === null
						? note({ ...task, start: { sessionId, at, error } }, { kind: "start-failed", error })
						: note({ ...task, start: { sessionId, at } }, { kind: "started", sessionId, ...(event.branch ? { branch: event.branch } : {}) }),
				),
			};
		}
		case "woke":
			return { ...state, tasks: edit(event.task, task => note(task, { kind: "woke", sessionId: event.sessionId })) };
		case "expire":
			return {
				...state,
				tasks: edit(event.task, task => {
					if (task.claim) return note({ ...task, claim: null, start: null }, { kind: "expired", sessionId: task.claim.sessionId });
					const unclaimed = note({ ...task, start: null }, { kind: "unclaimed", sessionId: task.start?.sessionId ?? null });
					if (exitsInARow(unclaimed) < MAX_EXITS) return unclaimed;
					// A session that keeps exiting would restart forever, each round running the setup again.
					const error = `Its last ${MAX_EXITS} sessions exited without marking it done.`;
					return note({ ...unclaimed, start: { sessionId: null, at, error } }, { kind: "start-failed", error });
				}),
			};
		case "land":
			return {
				...state,
				tasks: edit(event.task, task => {
					if (event.outcome === "landed") return note(task, { kind: "landed", text: event.text });
					if (event.outcome === "refused") return note(task, { kind: "land-refused", text: event.text });
					// A merge that failed reopens its Board task, so a new session starts on the thread, which ends on why.
					return note({ ...task, ...(task.doneAt !== null ? { doneAt: null, start: null } : {}) }, { kind: "land-failed", text: event.text });
				}),
			};
	}
}

/**
 * `state` with `change` applied at `now`, as the server appends it, or why it refuses. `event` is `null` when the
 * inbox file the change came in was applied before, which changes nothing.
 */
export function applyChange(state: BoardState, change: BoardChange, now: number): { ok: BoardState; event: BoardEvent | null } | { error: string } {
	if (change.request !== undefined && state.requests.includes(change.request)) return { ok: state, event: null };
	const refused = refusal(state, change);
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

const LAND_OUTCOMES: readonly unknown[] = ["landed", "failed", "refused"] satisfies LandOutcome[];

/** The change `value` holds, or `null` when it holds none; `server` admits the changes only the server makes. */
export function parseChange(value: unknown, server = false): BoardChange | null {
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
		case "edit": {
			const by = parseAuthor(value.by);
			const reply = value.reply === undefined ? undefined : Number.isSafeInteger(value.reply) && (value.reply as number) >= 0 ? (value.reply as number) : null;
			return by && reply !== null && isId(value.task) && isText(value.text, MAX_TEXT) ? { op: "edit", by, task: value.task, ...(reply === undefined ? {} : { reply }), text: value.text } : null;
		}
		case "close":
			return isId(value.task) && parseAuthor(value.by)?.kind === "user" ? { op: "close", by: { kind: "user" }, task: value.task } : null;
		// A `renew` line, from when a claim held a lease, reads as no event: the lease is gone, and the claim holds on its own.
		case "claim":
			return isId(value.task) && isText(value.sessionId, 200) && value.sessionId ? { op: "claim", task: value.task, sessionId: value.sessionId } : null;
		case "done":
			return isId(value.task) && isText(value.sessionId, 200) && value.sessionId && (value.text === undefined || isText(value.text, MAX_TEXT))
				? { op: "done", task: value.task, sessionId: value.sessionId, ...(typeof value.text === "string" ? { text: value.text } : {}) }
				: null;
		// A `worktree` an older start kept reads as nothing: the branch names where its sessions work.
		case "start":
			if (!server || !isId(value.task) || !(value.sessionId === null || isText(value.sessionId, 200))) return null;
			return {
				op: "start",
				task: value.task,
				sessionId: value.sessionId as string | null,
				...(isText(value.error, MAX_TEXT) ? { error: value.error } : {}),
				...(isText(value.branch, 200) && value.branch ? { branch: value.branch } : {}),
			};
		case "woke":
			return server && isId(value.task) && isText(value.sessionId, 200) ? { op: "woke", task: value.task, sessionId: value.sessionId } : null;
		case "expire":
			return server && isId(value.task) ? { op: "expire", task: value.task } : null;
		case "land": {
			// A line from before land outcomes holds `landed`, which reads as landed or failed.
			const outcome = LAND_OUTCOMES.includes(value.outcome) ? (value.outcome as LandOutcome) : typeof value.landed === "boolean" ? (value.landed ? "landed" : "failed") : null;
			return server && isId(value.task) && outcome !== null && isText(value.text, MAX_TEXT) ? { op: "land", task: value.task, outcome, text: value.text } : null;
		}
		default:
			return null;
	}
}

/** The event one log line holds, or `null`. */
function parseEvent(value: unknown): BoardEvent | null {
	if (!isRecord(value) || typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
	const change = parseChange(value, true);
	if (!change) return null;
	const event: BoardEvent = { ...change, at: value.at, ...(isText(value.request, 200) && value.request ? { request: value.request } : {}) };
	return change.op === "post" && isId(value.id) ? { ...event, id: value.id } : event;
}
