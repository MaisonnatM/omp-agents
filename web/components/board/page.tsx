/** The Board: channels and threads where people, omp sessions, and remote agents post, with an inbox per member; a message for a session wakes it. */
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { hashForPage } from "../../routing";
import { type BoardChange, type BoardCommand, boardIndex, boardMembers, type BoardState, commandChanges, type Message } from "../../../src/shared/board";
import { useShortcuts } from "../../shortcuts";
import type { CoreData } from "../module-views";
import { BoardList, InboxZero, listedThreads } from "./list";
import { type BoardRoute, type BoardView, resolveBoardView } from "./module";
import { useNow } from "./parts";
import { ThreadView } from "./thread-view";

export function BoardPage({ route, core, state, onChange }: { route: BoardRoute; core: CoreData; state: BoardState | null; onChange: (change: BoardChange) => Promise<void> }) {
	if (!state) return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading the board…</div>;
	return <Board view={route.view} open={route.thread} core={core} state={state} onChange={change => void onChange(change)} />;
}

function Board({ view: asked, open, core, state, onChange }: { view: BoardView; open: string | null; core: CoreData; state: BoardState; onChange: (change: BoardChange) => void }) {
	const setOpen = (thread: string | null) => (location.hash = hashForPage({ kind: "board", view: asked, thread }));
	/** Inbox items you read this visit, which stay listed until you leave the page, as a mail inbox keeps a message you just opened. */
	const [lingering, setLingering] = useState<Message[]>([]);
	const now = useNow();
	/** The channel list's filter, kept per view so the next and previous thread shortcuts step through the threads it shows. */
	const [filter, setFilter] = useState({ view: "", query: "" });

	const members = useMemo(() => boardMembers(state, core.hosts, core.bots ?? []), [state, core.hosts, core.bots]);
	const index = useMemo(() => boardIndex(state, members), [state, members]);
	const view = resolveBoardView(state, index.memberById, asked);
	const myQueue = index.queueByMember.get(state.me) ?? [];
	const viewKey = JSON.stringify(view);
	const query = filter.view === viewKey ? filter.query : "";

	useEffect(() => {
		if (!open) return;
		const fresh = myQueue.filter(msg => msg.thread === open);
		if (fresh.length === 0) return;
		setLingering(prev => [...prev, ...fresh.filter(msg => !prev.some(kept => kept.id === msg.id))]);
		onChange({ op: "read", member: state.me, thread: open, at: Math.max(...fresh.map(msg => msg.at)) });
	}, [open, state.messages.length]);

	function createThread(channel: string, title: string) {
		const id = `t-${crypto.randomUUID()}`;
		onChange({ op: "thread", thread: { id, channel, title, task: null, lease: null, createdAt: Date.now() } });
		setOpen(id);
	}

	const thread = open ? (index.threadById.get(open) ?? null) : null;
	const inboxItems = [...lingering.filter(kept => !myQueue.some(msg => msg.id === kept.id)), ...myQueue].toSorted((a, b) => b.at - a.at);
	const listed = listedThreads({ view, state, index, queue: inboxItems, query, open });
	const at = open ? listed.indexOf(open) : -1;
	/** Opens the thread `by` rows below or above the open one, or the list's first or last when none of its threads is open. */
	const step = (by: 1 | -1): boolean => {
		const next = at < 0 ? listed.at(by === 1 ? 0 : -1) : listed[at + by];
		if (!next) return false;
		setOpen(next);
		return true;
	};
	useShortcuts({ boardNextThread: () => step(1), boardPreviousThread: () => step(-1), boardCloseThread: () => (open ? (setOpen(null), true) : false) });
	const authors = thread ? new Set((index.messagesByThread.get(thread.id) ?? []).map(msg => msg.author)) : null;
	const working = authors ? members.find(member => member.sessionId && member.presence === "working" && authors.has(member.id)) : undefined;
	if (!thread && view.kind === "inbox" && inboxItems.length === 0) return <InboxZero />;
	return (
		<div className="@container h-full min-h-0">
			<div className="grid h-full min-h-0 grid-cols-[minmax(14rem,26rem)_minmax(0,1fr)] max-phone:grid-cols-1 @max-[46rem]:grid-cols-1">
				{/* Too narrow for the list beside a 30rem thread: an open thread takes the page, with a way back to the list. */}
				<div className={cn("grid min-h-0 min-w-0", thread && "@max-[46rem]:hidden max-phone:hidden")}>
					<BoardList state={state} index={index} view={view} open={open} onOpen={setOpen} onCreateThread={createThread} now={now} queue={inboxItems} query={query} onQuery={text => setFilter({ view: viewKey, query: text })} />
				</div>
			{thread ? (
				<ThreadView
					key={thread.id}
					state={state}
					index={index}
					thread={thread}
					members={members}
					now={now}
					typing={working}
					workspaces={core.workspaces}
					onPost={(text, cwd) => onChange({ op: "post", message: { id: crypto.randomUUID(), thread: thread.id, author: state.me, at: Date.now(), text, ...(cwd ? { cwd } : {}) } })}
					onCommand={(command: BoardCommand, arg: string) => onChange({ op: "all", changes: commandChanges({ members, me: state.me, thread, command, arg, now: Date.now(), newId: () => crypto.randomUUID() }) })}
					onClose={() => setOpen(null)}
					onPrevious={at > 0 ? () => step(-1) : undefined}
					onNext={at >= 0 && at < listed.length - 1 ? () => step(1) : undefined}
				/>
			) : (
				<div className="grid place-items-center text-sm text-muted-foreground @max-[46rem]:hidden max-phone:hidden">Pick a thread</div>
			)}
			</div>
		</div>
	);
}
