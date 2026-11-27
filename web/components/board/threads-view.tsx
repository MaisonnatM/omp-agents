/**
 * The Board's Threads view, as Slack's: every Workspace's Board threads with replies, the latest reply first, each a card with its
 * Workspace, the Board task, its last replies, and a reply field that opens the Board thread beside the list, where the reply box is.
 */
import { IconBubble3, IconHashtag } from "central-icons";
import { useMemo, useState } from "react";
import type { BoardAuthor, BoardState, BoardTask } from "../../../templates/omp/agent/extensions/board/log";
import { type Workspace, workspaceName } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import type { KnownSessions } from "../../labels";
import { CountPill } from "../count-pill";
import { BoardText, continues, MessageRow, TaskBody } from "./messages";
import { replyText } from "./search";
import { said, unreadOf, useSeen } from "./seen";
import { hashForThreads, revealThreadTab } from "./sidebar";

/** Threads the list shows at first and adds per **Show older threads**. */
const PAGE = 30;
/** Replies each card shows, the latest; Slack shows the rest behind a "N more replies" link. */
const PREVIEW = 2;

/** When Board thread `task` last moved: its last reply, else its post. */
const lastActivity = (task: BoardTask): number => said(task).at(-1)?.at ?? task.at;

/** The Board threads the Threads view lists: those with a reply, the latest reply first. */
export const threadsOf = (state: BoardState): BoardTask[] => state.tasks.filter(task => said(task).length > 0).sort((a, b) => lastActivity(b) - lastActivity(a));

export function ThreadsList({ state, workspaces, sessions, open }: { state: BoardState; workspaces: readonly Workspace[]; sessions: KnownSessions; open: number | null }) {
	const seen = useSeen();
	const [shown, setShown] = useState(PAGE);
	const threads = useMemo(() => threadsOf(state), [state]);
	const names = new Map(workspaces.map(each => [each.cwd, workspaceName(each.cwdDisplay)]));
	if (threads.length === 0)
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
				<IconBubble3 aria-hidden className="size-6 text-muted-foreground" />
				<p className="text-sm font-medium">No threads yet</p>
				<p className="max-w-xs text-sm text-muted-foreground">A Board task shows here once someone replies to it, across every Workspace.</p>
			</div>
		);
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<ol aria-label="Threads" className="flex flex-col gap-3 px-6 py-4 max-phone:px-3">
				{threads.slice(0, shown).map(task => (
					<li key={task.id}>
						<ThreadCard state={state} task={task} channel={names.get(task.workspace) ?? workspaceName(task.workspace)} sessions={sessions} open={task.id === open} unread={task.id === open ? 0 : unreadOf(task, seen[task.id])} />
					</li>
				))}
			</ol>
			{threads.length > shown && (
				<div className="flex justify-center pb-6">
					<Button variant="outline" size="sm" onClick={() => setShown(count => count + PAGE)}>
						Show older threads
					</Button>
				</div>
			)}
		</div>
	);
}

/** One Board thread's card: its Workspace and title, the Board task, "N more replies", the last replies with the unread ones tinted, and a reply field; each link opens the thread. */
function ThreadCard({ state, task, channel, sessions, open, unread }: { state: BoardState; task: BoardTask; channel: string; sessions: KnownSessions; open: boolean; unread: number }) {
	const replies = said(task);
	const latest = replies.slice(-PREVIEW);
	const hidden = replies.length - latest.length;
	const href = hashForThreads(task.id);
	const link = { ...activityControl("board.task.open"), href, onClick: revealThreadTab };
	let previous: { at: number; by: BoardAuthor } = task;
	return (
		<article aria-label={`Thread #${task.id} in #${channel}`} className={cn("overflow-hidden rounded-xl border border-border bg-background pb-3", open && "ring-2 ring-ring")}>
			<a {...link} className="flex min-w-0 items-center gap-1.5 px-5 pt-3 pb-1 text-sm hover:underline">
				<IconHashtag aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="shrink-0 font-semibold">{channel}</span>
				<span className="min-w-0 truncate text-muted-foreground">{task.title}</span>
				{unread > 0 && (
					<span aria-label={`${unread} unread`} className="ml-auto flex">
						<CountPill count={unread} />
					</span>
				)}
			</a>
			<MessageRow by={task.by} at={task.at} sessions={sessions} state={state} workspace={task.workspace} grouped={false}>
				<TaskBody short task={task} />
			</MessageRow>
			{hidden > 0 && (
				<a {...link} className="block w-fit px-5 py-1 text-xs font-semibold text-primary hover:underline">
					{hidden} more {hidden === 1 ? "reply" : "replies"}
				</a>
			)}
			<ol className="flex flex-col">
				{latest.map((reply, index) => {
					const grouped = continues(previous, reply);
					previous = reply;
					return (
						<li key={reply.at}>
							<MessageRow by={reply.by} at={reply.at} sessions={sessions} state={state} workspace={task.workspace} grouped={grouped} unread={index >= latest.length - unread}>
								<BoardText text={replyText(reply.by, reply.text)} editedAt={reply.editedAt} />
							</MessageRow>
						</li>
					);
				})}
			</ol>
			<a {...link} className="mx-5 mt-1 flex h-9 items-center rounded-lg border border-border px-3 text-sm text-muted-foreground hover:border-ring">
				Reply…
			</a>
		</article>
	);
}
