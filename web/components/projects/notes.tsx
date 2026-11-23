/** A project's Decisions and Recent activity cards: what was settled, and its log lines newest first. */
import { useState } from "react";
import { type BoardChange, type BoardState, type Message, type ProjectChannel, sessionMemberId } from "../../../src/shared/board";
import { hashForSession } from "../../../src/shared/sessions";
import { hashForPage } from "../../routing";
import { Button } from "@/components/ui/button";
import { Age } from "../age";
import { offerUndo } from "../toaster";
import { type KnownSessions, sessionLabel } from "../todo/links";
import { AddLine, Card, EmptyNote, type OnProjectChange, PROJECT_UNDO, RemoveButton } from "./parts";

/** Log lines Recent activity shows until **View all**. */
const RECENT = 8;

/** The title of the thread a project's own log lines go to. */
const LOG_THREAD = "Log";

export function Decisions({ channel: { id: channel, project }, readOnly, onChange }: { channel: ProjectChannel; readOnly: boolean; onChange: OnProjectChange }) {
	const remove = (text: string): void => {
		onChange({ op: "decision", channel, text, remove: true });
		offerUndo(PROJECT_UNDO, `Removed “${text}”`, () => onChange({ op: "decision", channel, text, remove: false }));
	};
	return (
		<Card title="Decisions" meta={project.decisions.length > 0 ? String(project.decisions.length) : undefined}>
			{project.decisions.length === 0 ? (
				<EmptyNote>Record what was settled and why, so later sessions don't reopen it.</EmptyNote>
			) : (
				<ul className="flex flex-col px-4 py-1.5">
					{project.decisions.map(text => (
						<li key={text} className="group/item flex min-h-9 items-start gap-2.5 py-1.5 text-sm leading-snug">
							<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
							<span className="min-w-0 flex-1 break-words">{text}</span>
							{!readOnly && <RemoveButton control="projects.decision.remove" label={`Remove the decision “${text}”`} onClick={() => remove(text)} />}
						</li>
					))}
				</ul>
			)}
			{!readOnly && <AddLine control="projects.decision.add" label="Add a decision" onAdd={text => onChange({ op: "decision", channel, text, remove: false })} />}
		</Card>
	);
}

/** Posts `text` to project `channel`'s Log thread, opening the thread first when it has none. */
function logLine(board: BoardState, channel: string, text: string): BoardChange {
	const at = Date.now();
	const existing = board.threads.find(thread => thread.channel === channel && thread.task === null && thread.title === LOG_THREAD);
	const thread = existing ?? { id: crypto.randomUUID(), channel, title: LOG_THREAD, task: null, lease: null, createdAt: at };
	const post: BoardChange = { op: "post", message: { id: crypto.randomUUID(), thread: thread.id, author: board.me, at, text } };
	return existing ? post : { op: "all", changes: [{ op: "thread", thread }, post] };
}

/** Who wrote `message`: a session's name, linking to it, You, or the member id. */
function Author({ message, board, sessions }: { message: Message; board: BoardState; sessions: KnownSessions }) {
	if (message.author === board.me) return <span className="font-medium">You</span>;
	const sessionId = message.author.startsWith(sessionMemberId("")) ? message.author.slice(sessionMemberId("").length) : null;
	if (sessionId === null) return <span className="font-medium">{board.extraMembers.find(member => member.id === message.author)?.name ?? message.author}</span>;
	return (
		<a href={hashForSession(sessionId)} className="font-medium hover:underline">
			{sessionLabel(sessionId, sessions).name}
		</a>
	);
}

export function RecentActivity({ channel, board, log, sessions, readOnly, onChange }: { channel: ProjectChannel; board: BoardState; log: readonly Message[]; sessions: KnownSessions; readOnly: boolean; onChange: OnProjectChange }) {
	const [all, setAll] = useState(false);
	const newest = log.toReversed();
	const shown = all ? newest : newest.slice(0, RECENT);
	return (
		<Card
			title="Recent activity"
			action={
				<>
					{newest.length > RECENT && (
						<Button variant="ghost" size="xs" onClick={() => setAll(!all)}>
							{all ? "Show fewer" : "View all"}
						</Button>
					)}
					<Button variant="ghost" size="xs" render={<a href={hashForPage({ kind: "board", view: { kind: "channel", id: channel.id }, thread: null })} />}>
						Open in Board
					</Button>
				</>
			}
		>
			{newest.length === 0 ? (
				<EmptyNote>Sessions add a line here as they finish a step.</EmptyNote>
			) : (
				<ol className="flex flex-col px-4 py-1.5">
					{shown.map(entry => (
						<li key={entry.id} className="flex items-start gap-2.5 py-1.5 text-sm leading-snug">
							<p className="min-w-0 flex-1 break-words">
								<Author message={entry} board={board} sessions={sessions} />{" "}
								<span className="text-muted-foreground">{entry.text}</span>
							</p>
							<time dateTime={new Date(entry.at).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
								<Age at={entry.at} compact exact className="tabular-nums" /> ago
							</time>
						</li>
					))}
				</ol>
			)}
			{!readOnly && <AddLine control="projects.log.add" label="Add a log line" onAdd={text => onChange(logLine(board, channel.id, text))} />}
		</Card>
	);
}
