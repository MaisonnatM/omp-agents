/**
 * The Board page: the open Workspace's Board tasks as messages with a composer that posts one, and the open Board
 * task's Board thread at the right; the sidebar's Board tab lists the Workspaces, in `./sidebar.tsx`.
 */
import { IconCrossMedium } from "central-icons";
import { useState } from "react";
import type { Workspace } from "../../../src/shared/workspaces";
import { type BoardAuthor, type BoardChange, type BoardNote, type BoardState, type BoardStatus, type BoardTask, MAX_TITLE, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { useMinute } from "../../use-minute";
import { Age } from "../age";
import type { CoreData } from "../module-views";
import { type KnownSessions, sessionLabel } from "../todo/links";
import type { BoardRoute } from "./module";
import { boardWorkspaces, hashForBoard } from "./sidebar";

interface BoardPageProps {
	route: BoardRoute;
	core: CoreData;
	state: BoardState | null;
	disabled: boolean;
	onChange: (change: BoardChange) => Promise<void>;
}

export function BoardPage({ route, core, state, disabled, onChange }: BoardPageProps) {
	useMinute();
	if (state === null) return <p className="px-6 py-6 text-sm text-muted-foreground">Loading the Board…</p>;
	const { open: openWorkspace } = boardWorkspaces(state, core.workspaces, core.workspace, route);
	const open = openWorkspace?.cwd ?? null;
	const tasks = state.tasks.filter(task => task.workspace === open);
	const thread = route.thread === null ? null : (tasks.find(task => task.id === route.thread) ?? null);
	return (
		<div className="flex h-full min-h-0 flex-1">
			<main className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-14 shrink-0 flex-col justify-center border-b border-border px-6">
					<h1 className="truncate text-sm font-semibold">{openWorkspace ? folder(openWorkspace.cwdDisplay) : "No workspace"}</h1>
					<p className="text-xs text-muted-foreground">Each message is a Board task, and a session starts on it.</p>
				</header>
				<ol aria-label="Board tasks" className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
					{tasks.length === 0 && <li className="px-6 py-6 text-sm text-muted-foreground">No Board tasks yet. Post one below.</li>}
					{tasks.map(task => (
						<li key={task.id}>
							<TaskMessage state={state} task={task} sessions={core.sessions} open={task.id === route.thread} href={hashForBoard(open, task.id)} />
						</li>
					))}
				</ol>
				{openWorkspace && <Composer key={openWorkspace.cwd} workspace={openWorkspace} state={state} tasks={tasks} disabled={disabled} onChange={onChange} />}
			</main>
			{thread && <Thread state={state} task={thread} sessions={core.sessions} workspace={openWorkspace} closeHref={hashForBoard(open)} disabled={disabled} onChange={onChange} />}
		</div>
	);
}

const folder = (display: string): string => display.split("/").filter(Boolean).pop() ?? display;

function authorName(by: BoardAuthor, sessions: KnownSessions): string {
	return by.kind === "user" ? "You" : sessionLabel(by.sessionId, sessions).name;
}

function StatusBadge({ status, sessions }: { status: BoardStatus; sessions: KnownSessions }) {
	switch (status.kind) {
		case "ready":
			return (
				<Badge variant="dot" size="compact" color="blue">
					ready
				</Badge>
			);
		case "waiting":
			return (
				<Badge variant="dot" size="compact" color="gray">
					waiting on #{status.on}
				</Badge>
			);
		case "claimed":
			return (
				<Badge variant="dot" size="compact" color="amber">
					claimed by {sessionLabel(status.sessionId, sessions).name} · {Math.max(0, Math.ceil((status.until - Date.now()) / 60_000))} min left
				</Badge>
			);
		case "done":
			return (
				<Badge variant="dot" size="compact" color="green">
					done
				</Badge>
			);
	}
}

function TaskMessage({ state, task, sessions, open, href }: { state: BoardState; task: BoardTask; sessions: KnownSessions; open: boolean; href: string }) {
	const said = task.replies.filter(entry => "by" in entry);
	const last = task.replies.at(-1);
	return (
		<a {...activityControl("board.task.open")} href={href} aria-current={open ? "true" : undefined} className={cn("flex flex-col gap-1 px-6 py-2.5 hover:bg-accent/50", open && "bg-accent/60")}>
			<span className="flex items-baseline gap-2 text-sm">
				<span className="font-semibold">{authorName(task.by, sessions)}</span>
				<Age at={task.at} exact className="text-xs text-muted-foreground tabular-nums" />
			</span>
			<span className="text-sm text-pretty">
				<span className="text-muted-foreground tabular-nums">#{task.id}</span> {task.title}
			</span>
			<span className="flex flex-wrap items-center gap-1.5">
				<StatusBadge status={statusOf(state, task)} sessions={sessions} />
				{Object.entries(task.labels).map(([key, value]) => (
					<Badge key={key} variant="dot" size="compact" color="gray">
						{key}={value}
					</Badge>
				))}
			</span>
			{task.replies.length > 0 && last && (
				<span className="text-xs text-muted-foreground">
					{said.length} {said.length === 1 ? "reply" : "replies"} · last <Age at={last.at} className="tabular-nums" />
				</span>
			)}
		</a>
	);
}

const NOTHING = "nothing";

function Composer({ workspace, state, tasks, disabled, onChange }: { workspace: Workspace; state: BoardState; tasks: BoardTask[]; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const [text, setText] = useState("");
	const [needs, setNeeds] = useState(NOTHING);
	const open = tasks.filter(task => task.doneAt === null);
	const send = (value: string) => {
		const message = value.trim();
		if (!message || disabled) return;
		const [first = ""] = message.split("\n");
		const title = first.length > MAX_TITLE ? `${first.slice(0, MAX_TITLE - 1)}…` : first;
		const needed = needs === NOTHING ? [] : [Number(needs)];
		void onChange({ op: "post", by: { kind: "user" }, workspace: workspace.cwd, title, ...(message !== title ? { text: message } : {}), ...(needed.length ? { needs: needed } : {}) });
		setText("");
		setNeeds(NOTHING);
	};
	const waits = needs !== NOTHING && state.tasks.find(task => task.id === Number(needs))?.doneAt === null;
	return (
		<div className="mx-auto w-full max-w-conversation shrink-0 px-3 pb-3">
			<InputMessage
				{...activityControl("board.post")}
				value={text}
				onValueChange={setText}
				onSend={send}
				placeholder={`Message ${folder(workspace.cwdDisplay)}: what should a session do?`}
				disabled={disabled}
				sendLabel={waits ? "Send: a session starts once that one is done" : "Send: a session starts on it"}
				leftSlot={
					<Select value={needs} onValueChange={next => next && setNeeds(next)}>
						<SelectTrigger {...activityControl("board.needs")} aria-label="Needs" className="max-w-64 min-w-0 text-xs [&>span]:truncate">
							<SelectValue>{({ value }) => (value === NOTHING ? "Needs nothing" : `Needs #${value} ${open.find(task => String(task.id) === value)?.title ?? ""}`)}</SelectValue>
						</SelectTrigger>
						<SelectContent side="top" alignItemWithTrigger={false}>
							<SelectItem value={NOTHING}>nothing</SelectItem>
							{open.map(task => (
								<SelectItem key={task.id} value={String(task.id)}>
									#{task.id} {task.title}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			/>
		</div>
	);
}

function noteText(note: BoardNote, sessions: KnownSessions): string {
	const name = (id: string | null): string => (id === null ? "The session" : sessionLabel(id, sessions).name);
	switch (note.kind) {
		case "started":
			return `Started ${name(note.sessionId)} on this Board task.`;
		case "start-failed":
			return `No session could start on it: ${note.error}`;
		case "claimed":
			return `${name(note.sessionId)} claimed this Board task. Lease 15 min.`;
		case "renewed":
			return `${name(note.sessionId)} renewed its lease.`;
		case "expired":
			return `${name(note.sessionId)}'s lease ran out, so a new session starts on it.`;
		case "unclaimed":
			return `${name(note.sessionId)} never claimed it, so a new session starts on it.`;
		case "ready":
			return `#${note.task} is done, so this Board task is ready.`;
		case "woke":
			return `${name(note.sessionId)} had stopped. The reply woke it.`;
		case "done":
			return `${name(note.sessionId)} marked this Board task done.`;
	}
}

function Thread({ state, task, sessions, workspace, closeHref, disabled, onChange }: { state: BoardState; task: BoardTask; sessions: KnownSessions; workspace: Workspace | null; closeHref: string; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	const [text, setText] = useState("");
	const said = task.replies.filter(entry => "by" in entry).length;
	const target = wakeTarget(task, { kind: "user" });
	const send = (value: string) => {
		const reply = value.trim();
		if (!reply || disabled) return;
		void onChange({ op: "reply", by: { kind: "user" }, task: task.id, text: reply });
		setText("");
	};
	return (
		<aside aria-label={`Thread #${task.id}`} className="flex w-[400px] shrink-0 flex-col border-l border-border">
			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
				<div className="min-w-0 flex-1">
					<h2 className="text-sm font-semibold">Thread #{task.id}</h2>
					{workspace && <p className="truncate text-xs text-muted-foreground">{folder(workspace.cwdDisplay)}</p>}
				</div>
				<Button {...activityControl("board.thread.close")} variant="ghost" size="icon-xs" aria-label="Close thread" render={<a href={closeHref} />}>
					<IconCrossMedium />
				</Button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
				<div className="flex flex-col gap-1">
					<span className="flex items-baseline gap-2 text-sm">
						<span className="font-semibold">{authorName(task.by, sessions)}</span>
						<Age at={task.at} exact className="text-xs text-muted-foreground tabular-nums" />
					</span>
					<p className="text-sm text-pretty">
						<span className="text-muted-foreground tabular-nums">#{task.id}</span> {task.title}
					</p>
					{task.text && task.text !== task.title && <p className="text-sm whitespace-pre-wrap text-pretty">{task.text}</p>}
					<span>
						<StatusBadge status={statusOf(state, task)} sessions={sessions} />
					</span>
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>
						{said} {said === 1 ? "reply" : "replies"}
					</span>
					<span className="h-px flex-1 bg-border" />
				</div>
				<ol className="flex flex-col gap-2.5">
					{task.replies.map((entry, index) =>
						"note" in entry ? (
							<li key={index} className="text-xs text-muted-foreground">
								<Age at={entry.at} className="tabular-nums" /> · {noteText(entry.note, sessions)}
							</li>
						) : (
							<li key={index} className="flex flex-col gap-0.5">
								<span className="flex items-baseline gap-2 text-sm">
									<span className="font-semibold">{authorName(entry.by, sessions)}</span>
									<Age at={entry.at} exact className="text-xs text-muted-foreground tabular-nums" />
								</span>
								<p className="text-sm whitespace-pre-wrap text-pretty">{entry.text}</p>
							</li>
						),
					)}
				</ol>
			</div>
			<div className="shrink-0 px-3 pb-3">
				<InputMessage
					{...activityControl("board.reply")}
					value={text}
					onValueChange={setText}
					onSend={send}
					placeholder={target ? `Reply. It reaches ${sessionLabel(target, sessions).name}, and wakes it if it stopped.` : "Reply on this Board thread."}
					disabled={disabled}
					sendLabel="Send reply"
				/>
			</div>
		</aside>
	);
}
