// The Board: Board tasks the user and sessions post for each other in a Workspace, one Board thread each, which the
// omp-agents dashboard keeps and starts a session on once each is ready. The `board` tool posts, replies, claims, marks
// done, lists, and reads them. Changes go to the dashboard's board inbox, one file each, which the dashboard server
// appends to its event log, board-events.jsonl, so it stays the log's only writer. A claim, done, or post waits a few
// seconds for the dashboard to take it or set it aside as refused, so the tool reports what happened. `done` first
// runs the quick checks of `.omp/land.json` on the committed branch; see board/checks.ts. A subagent acts for its
// top-level session: a claim it makes is that session's.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { doneRefusal } from "./board/checks";
import { type BoardAuthor, type BoardChange, type BoardState, type BoardTask, MAX_LABELS, MAX_TEXT, MAX_TITLE, readLog, refusal, statusOf } from "./board/log";
import { CONFIG_DIR, inbox, reply } from "./inbox/client";

const LOG_FILE = join(CONFIG_DIR, "board-events.jsonl");
const INBOX = inbox<BoardChange>(join(CONFIG_DIR, "board-changes"));
/** How long a change waits for the dashboard to take it before the tool answers without it. */
const TAKE_WAIT_MS = 6000;

function board(): BoardState {
	try {
		return readLog(readFileSync(LOG_FILE, "utf8"));
	} catch {
		return readLog("");
	}
}

/**
 * The session a claim belongs to: this one, or for a subagent, whose session file sits in its parent's folder
 * (`<parent>/<agent>.jsonl`), the top-level session that folder belongs to.
 */
function topSessionId(ctx: ExtensionContext): string {
	let file = ctx.sessionManager.getSessionFile();
	if (ctx.agent.kind !== "sub" || !file) return ctx.sessionManager.getSessionId();
	let top: string | null = null;
	for (let depth = 0; depth < 8; depth++) {
		const parent = `${dirname(file)}.jsonl`;
		const id = headerId(parent);
		if (id === null) break;
		top = id;
		file = parent;
	}
	return top ?? ctx.sessionManager.getSessionId();
}

/** The id in the `session` header of the session file at `path`, or `null` when there is none. */
function headerId(path: string): string | null {
	let text: string;
	try {
		text = readFileSync(path, "utf8").slice(0, 64_000);
	} catch {
		return null;
	}
	for (const line of text.split("\n").slice(0, 10)) {
		try {
			const entry = JSON.parse(line);
			if (entry?.type === "session" && typeof entry.id === "string") return entry.id;
		} catch {}
	}
	return null;
}

/** The Workspace `cwd` belongs to: its repository's main checkout, or `cwd` itself outside git. */
function workspaceOf(cwd: string): string {
	const git = spawnSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
	const common = git.status === 0 ? git.stdout.trim() : "";
	return common && basename(common) === ".git" ? dirname(common) : cwd;
}

/**
 * Waits up to {@link TAKE_WAIT_MS} for the log to show what `taken` looks for, or for the dashboard to set `change`'s
 * inbox file, `file`, aside as refused, with why as the Board says now; `null` when the dashboard has done neither.
 */
async function untilTaken<T>(file: string, change: BoardChange, taken: (state: BoardState) => T | null): Promise<{ taken: T } | { refused: string } | null> {
	const end = Date.now() + TAKE_WAIT_MS;
	for (;;) {
		const state = board();
		const found = taken(state);
		if (found !== null) return { taken: found };
		if (existsSync(`${file}.invalid`)) return { refused: refusal(state, change) ?? "The dashboard did not take it; its log says why." };
		if (Date.now() >= end) return null;
		await sleep(250);
	}
}

const who = (by: BoardAuthor, me: string): string => (by.kind === "user" ? "the user" : by.sessionId === me ? "this session" : `session ${by.sessionId}`);
const clock = (at: number): string => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function statusText(state: BoardState, task: BoardTask, me: string): string {
	const status = statusOf(state, task);
	switch (status.kind) {
		case "done":
			return "done";
		case "waiting":
			return `waiting on #${status.on}`;
		case "ready":
			return "ready";
		case "failed":
			return `its session failed to start: ${status.error}`;
		case "claimed":
			return `claimed by ${status.sessionId === me ? "this session" : `session ${status.sessionId}`}`;
	}
}

function taskLine(state: BoardState, task: BoardTask, me: string): string {
	const labels = Object.entries(task.labels).map(([key, value]) => ` ${key}=${value}`);
	const said = task.replies.filter(entry => "by" in entry).length;
	return `#${task.id} ${task.title} [${statusText(state, task, me)}]${labels.join("")} (by ${who(task.by, me)}, ${said} replies)`;
}

function threadText(state: BoardState, task: BoardTask, me: string): string {
	const lines = [`${taskLine(state, task, me)}`, `Workspace: ${task.workspace}`];
	if (task.needs.length) lines.push(`Needs: ${task.needs.map(id => `#${id}`).join(", ")}`);
	if (task.text) lines.push("", task.text);
	for (const entry of task.replies) {
		if ("by" in entry) lines.push("", `${clock(entry.at)} ${who(entry.by, me)}: ${entry.text}`);
		else lines.push("", `${clock(entry.at)} · ${entry.note.kind}${"sessionId" in entry.note && entry.note.sessionId ? ` ${entry.note.sessionId === me ? "this session" : entry.note.sessionId}` : ""}`);
	}
	return lines.join("\n");
}

const DASHBOARD_DOWN = "The dashboard has not taken it yet; it will once it runs.";
const refusedText = (what: string, why: string): string => `The dashboard refused ${what}: ${why}`;

export default function boardExtension(pi: ExtensionAPI) {
	const z = pi.zod;
	const input = z.object({
		action: z.enum(["post", "reply", "claim", "done", "list", "read"]).describe("what to do"),
		task: z.number().int().positive().optional().describe("reply, claim, done, read: the Board task's number, without the #"),
		title: z.string().max(MAX_TITLE).optional().describe("post: one line saying what the Board task asks for"),
		text: z.string().max(MAX_TEXT).optional().describe("post: the details; reply: the reply; done: the message the user reads in the thread, the outcome or your question. Markdown, shown rendered: a short lead line, then bullets or a numbered list, one point per item, with `code` for paths and commands; never one long paragraph. done ends with a Suggestions block: a line \"Suggestions:\", then one to three numbered prompts the user may pick, best first"),
		labels: z.record(z.string().max(40), z.string().max(80)).optional().describe("post: key=value labels, such as area=web"),
		needs: z.array(z.number().int().positive()).max(20).optional().describe("post: the Board tasks that must be done before this one is ready"),
		workspace: z.string().optional().describe("post, list: the Workspace's directory, absolute or from this session's; defaults to this session's; list takes all for every Workspace"),
	});
	pi.registerTool({
		name: "board",
		label: "Board",
		description: [
			"The omp-agents dashboard's Board: Board tasks for sessions in a Workspace, each with a Board thread.",
			"The dashboard starts a new session on each ready Board task, in the Board task's own worktree and branch; that session owns the Board task from its start and does not claim it.",
			"Commit your work on that branch; land or merge only when the user's last message asks for it.",
			"Reply on the thread only to ask something while you work. When you finish, or need the user's answer before you go on, mark the Board task done once, with the message the user reads: done ends the session after this turn and makes the Board tasks that need it ready.",
			"When the branch has commits its target lacks and the repository has .omp/land.json, done first runs that file's quick checks on the committed branch, and is refused with their output when one fails: fix the cause, commit, and mark it done again.",
			"The user's reply on a done Board task starts a new session on it; a reply on one that is not done reaches its session, and wakes it if it stopped.",
			"Claim is only for an interactive session that takes a Board task by hand.",
		].join(" "),
		parameters: input,
		async execute(_id, raw, signal, _onUpdate, ctx) {
			const parsed = input.safeParse(raw);
			if (!parsed.success) return reply("Invalid board input.", true);
			const args = parsed.data;
			const me = topSessionId(ctx);
			const state = board();
			if (args.action === "list") {
				const where = args.workspace === "all" ? null : args.workspace ? resolve(ctx.cwd, args.workspace) : workspaceOf(ctx.cwd);
				const tasks = state.tasks.filter(task => where === null || task.workspace === where);
				if (!tasks.length) return reply(where === null ? "The Board holds no Board task." : `The Board holds no Board task for ${where}.`);
				return reply(tasks.map(task => taskLine(state, task, me)).join("\n"));
			}
			if (args.action === "post") {
				const title = args.title?.replace(/\s+/g, " ").trim() ?? "";
				const labels = args.labels ?? {};
				if (Object.keys(labels).length > MAX_LABELS) return reply(`A Board task takes ${MAX_LABELS} labels at most.`, true);
				const change: BoardChange = { op: "post", by: { kind: "session", sessionId: me }, workspace: args.workspace ? resolve(ctx.cwd, args.workspace) : workspaceOf(ctx.cwd), title, ...(args.text ? { text: args.text } : {}), ...(Object.keys(labels).length ? { labels } : {}), ...(args.needs?.length ? { needs: args.needs } : {}) };
				const refused = refusal(state, change);
				if (refused) return reply(refused, true);
				const file = INBOX.leave(change);
				const known = new Set(state.tasks.map(task => task.id));
				const posted = await untilTaken(file, change, next => next.tasks.find(task => !known.has(task.id) && task.by.kind === "session" && task.by.sessionId === me && task.title === title) ?? null);
				if (!posted) return reply(`Posted "${title}". ${DASHBOARD_DOWN}`);
				if ("refused" in posted) return reply(refusedText("the post", posted.refused), true);
				return reply(`Posted Board task #${posted.taken.id} in ${posted.taken.workspace}; it is ${statusText(board(), posted.taken, me)}. A session starts on it once it is ready.`);
			}
			if (args.task === undefined) return reply(`${args.action} needs the Board task's number.`, true);
			const id = args.task;
			const current = state.tasks.find(task => task.id === id);
			if (!current) return reply(`There is no Board task #${id}.`, true);
			if (args.action === "read") return reply(threadText(state, current, me));
			let change: BoardChange;
			switch (args.action) {
				case "reply":
					change = { op: "reply", by: { kind: "session", sessionId: me }, task: id, text: args.text ?? "" };
					break;
				case "claim":
					change = { op: "claim", sessionId: me, task: id };
					break;
				case "done":
					change = { op: "done", sessionId: me, task: id, ...(args.text ? { text: args.text } : {}) };
					break;
			}
			const refused = refusal(state, change);
			if (refused) return reply(refused, true);
			if (args.action === "done") {
				const failed = await doneRefusal(ctx.cwd, signal);
				if (failed) return reply(failed, true);
			}
			const file = INBOX.leave(change);
			if (args.action === "reply") return reply(`Replied on Board task #${id}.`);
			if (args.action === "done") {
				const done = await untilTaken(file, change, next => next.tasks.find(task => task.id === id && task.doneAt !== null) ?? null);
				if (done && "refused" in done) return reply(refusedText(`marking Board task #${id} done`, done.refused), true);
				const after = board();
				const freed = after.tasks.filter(task => task.needs.includes(id) && statusOf(after, task).kind === "ready");
				return reply(done ? `Board task #${id} is done.${freed.length ? ` Now ready: ${freed.map(task => `#${task.id}`).join(", ")}.` : ""}` : `Marked Board task #${id} done. ${DASHBOARD_DOWN}`);
			}
			const held = await untilTaken(file, change, next => next.tasks.find(task => task.id === id)?.claim ?? null);
			if (!held) return reply(`Asked to claim Board task #${id}. ${DASHBOARD_DOWN}`);
			if ("refused" in held) return reply(refusedText(`the claim on Board task #${id}`, held.refused), true);
			if (held.taken.sessionId !== me) return reply(`Board task #${id} is claimed by session ${held.taken.sessionId}.`, true);
			return reply(`Claimed Board task #${id}; mark it done when you finish.\n\n${threadText(board(), current, me)}`);
		},
	});
}
