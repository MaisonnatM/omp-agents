/** The Board's list column: your inbox, the schedules, a channel's threads, or a member's queue, each a card per thread. */
import { IconBell, IconClock, IconHashtag, IconMagnifyingGlass, IconPlusSmall } from "central-icons";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { type BoardIndex, type BoardState, isMention, type Member, type Message, repeatLabel, type Thread } from "../../../src/shared/board";
import { attachmentLabel } from "./attachments";
import type { BoardView } from "./module";
import { Avatar, Chip, feedLead, NameDialog, relTime, TaskChip } from "./parts";
import { plainMarkdown } from "../../labels";

/** What every list reads: the board, its index, the open thread, and the clock. */
interface ListProps {
	state: BoardState;
	index: BoardIndex;
	open: string | null;
	onOpen: (id: string) => void;
	now: number;
}

const INBOX_META = "Mentions and replies waiting for you";

/** The list `view` asks for; `queue` is the inbox's items, `query` the channel filter, `onCreateThread` makes a thread in a channel. */
export function BoardList({ view, queue, query, onQuery, onCreateThread, ...props }: ListProps & { view: BoardView; queue: Message[]; query: string; onQuery: (query: string) => void; onCreateThread: (channel: string, title: string) => void }) {
	switch (view.kind) {
		case "inbox":
			return <InboxList {...props} queue={queue} />;
		case "scheduled":
			return <ScheduledList {...props} />;
		case "channel":
			return <ChannelList key={view.id} {...props} channel={view.id} query={query} onQuery={onQuery} onCreateThread={onCreateThread} />;
		case "member":
			return <MemberList {...props} member={view.id} />;
	}
}

/** The ids of the threads `view` lists, top to bottom, which the next and previous thread shortcuts step through. */
export function listedThreads({ view, state, index, queue, query }: { view: BoardView; state: BoardState; index: BoardIndex; queue: Message[]; query: string }): string[] {
	switch (view.kind) {
		case "inbox":
			return queueThreads(index, queue).map(thread => thread.id);
		case "scheduled":
			return [...new Set(state.schedules.toSorted((a, b) => a.at - b.at).map(item => item.thread))];
		case "channel":
			return channelThreads(state, index, view.id, query).map(thread => thread.id);
		case "member":
			return queueThreads(index, index.queueByMember.get(view.id) ?? []).map(thread => thread.id);
	}
}

function channelThreads(state: BoardState, index: BoardIndex, channel: string, query: string): Thread[] {
	const at = (thread: Thread) => index.lastByThread.get(thread.id)?.at ?? 0;
	return state.threads.filter(thread => thread.channel === channel && thread.title.toLowerCase().includes(query.toLowerCase())).toSorted((a, b) => at(b) - at(a));
}

function queueThreads(index: BoardIndex, messages: Message[]): Thread[] {
	return [...new Set(messages.map(msg => msg.thread))].flatMap(id => index.threadById.get(id) ?? []);
}

/** The whole page when the inbox is empty and no thread is open. */
export function InboxZero() {
	return (
		<section aria-label="Inbox" className="flex h-full min-h-0 flex-col">
			<ListHeader title="Inbox" meta={INBOX_META} />
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<IconBell />
					</EmptyMedia>
					<EmptyTitle>Inbox zero</EmptyTitle>
					<EmptyDescription>Agents will ping you here.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</section>
	);
}

function InboxList({ queue, ...props }: ListProps & { queue: Message[] }) {
	const me = props.index.memberById.get(props.state.me);
	return (
		<ListFrame title="Inbox" meta={INBOX_META}>
			<QueueList {...props} messages={queue} member={me} empty="Inbox zero. Agents will ping you here." />
		</ListFrame>
	);
}

function ScheduledList({ state, index, onOpen, now }: ListProps) {
	return (
		<ListFrame title="Scheduled" meta="Messages agents get later; a repeat is a cron">
			{state.schedules
				.toSorted((a, b) => a.at - b.at)
				.map(item => {
					const to = index.memberById.get(item.to);
					return (
						<button key={item.id} type="button" onClick={() => onOpen(item.thread)} className="flex w-full gap-3 border-b border-border px-4 py-3 text-left hover:bg-accent/60">
							{to && <Avatar member={to} size="md" />}
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-2 text-sm font-medium">
									{to?.name ?? item.toName}
									<span className="ml-auto flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
										<IconClock className="size-3" />
										{relTime(item.at, now)}
									</span>
								</span>
								<span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{item.text}</span>
								<span className="mt-1.5 flex min-w-0 gap-1.5">
									<Chip>{item.every ? repeatLabel(item.every) : "once"}</Chip>
									<Chip>{index.threadById.get(item.thread)?.title}</Chip>
								</span>
							</span>
						</button>
					);
				})}
		</ListFrame>
	);
}

function ChannelList({ channel: id, query: q, onQuery, onCreateThread, ...props }: ListProps & { channel: string; query: string; onQuery: (query: string) => void; onCreateThread: (channel: string, title: string) => void }) {
	const { state, index, open, onOpen, now } = props;
	const [naming, setNaming] = useState(false);
	const channel = index.channelById.get(id);
	if (!channel) return null;
	const threads = channelThreads(state, index, id, q);
	const title = `#${channel.name}`;
	return (
		<ListFrame
			title={title}
			meta={channel.about}
			action={
				<Button size="compact" variant="outline" onClick={() => setNaming(true)}>
					<IconPlusSmall />
					New thread
				</Button>
			}
			filter={
				<label className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-sm text-muted-foreground">
					<IconMagnifyingGlass className="size-3.5" />
					<input value={q} onChange={event => onQuery(event.target.value)} placeholder="Filter threads" className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
				</label>
			}
		>
			{threads.length === 0 ? <ListEmpty>{q ? "No thread matches." : "No threads yet. Start one with New thread."}</ListEmpty> : threads.map(thread => <ThreadCard key={thread.id} thread={thread} index={index} now={now} selected={open === thread.id} onOpen={onOpen} inChannel />)}
			{naming && <NameDialog title={`New thread in ${title}`} label="Thread title" onSave={name => onCreateThread(id, name)} onClose={() => setNaming(false)} />}
		</ListFrame>
	);
}

const PRESENCE_LINE = { working: "Working now", idle: "Idle, will pick up new messages", asking: "Waiting on an answer", asleep: "Asleep, messages queue", online: "Online", away: "Away" } as const;

function MemberList({ member: id, ...props }: ListProps & { member: string }) {
	const member = props.index.memberById.get(id);
	if (!member) return null;
	const waiting = props.index.queueByMember.get(id) ?? [];
	return (
		<ListFrame title={member.name} meta={member.kind === "human" ? "Person" : (member.harness ?? "")}>
			<div className="flex items-center gap-3 border-b border-border px-4 py-4">
				<Avatar member={member} size="md" />
				<div className="min-w-0 flex-1 text-sm">
					<p className="font-medium">{PRESENCE_LINE[member.presence]}</p>
					<p className="text-xs text-muted-foreground">
						{waiting.length} message{waiting.length === 1 ? "" : "s"} waiting in their inbox
					</p>
				</div>
			</div>
			{member.presence === "asleep" && waiting.length > 0 && (
				<div className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
					Queued. {member.name} reads these the moment its machine wakes; mentions from people and threads it holds a lease on wake it first.
				</div>
			)}
			<p className="px-4 pt-4 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Their queue</p>
			<QueueList {...props} messages={waiting} member={member} empty="Nothing waiting." />
		</ListFrame>
	);
}

function ListFrame({ title, meta, action, filter, children }: { title: string; meta: string; action?: ReactNode; filter?: ReactNode; children: ReactNode }) {
	return (
		<section aria-label={title} className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border">
			<ListHeader title={title} meta={meta} action={action} />
			{filter}
			<div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
		</section>
	);
}

function ListHeader({ title, meta, action }: { title: string; meta: string; action?: ReactNode }) {
	return (
		<header className="flex h-(--page-header-height) shrink-0 items-center gap-3 border-b border-border px-4">
			<div className="min-w-0 flex-1">
				<h2 className="truncate text-sm font-semibold">{title}</h2>
				<p className="truncate text-xs text-muted-foreground">{meta}</p>
			</div>
			{action}
		</header>
	);
}

/** `messages` as one card per thread, previewing its latest, marked when one mentions `member`. */
function QueueList({ index, open, onOpen, now, messages, member, empty }: ListProps & { messages: Message[]; member: Member | undefined; empty: string }) {
	const groups = [...Map.groupBy(messages, msg => msg.thread)].flatMap(([id, msgs]) => {
		const thread = index.threadById.get(id);
		return thread ? [{ thread, msgs }] : [];
	});
	if (groups.length === 0) return <ListEmpty>{empty}</ListEmpty>;
	return groups.map(({ thread, msgs }) => <ThreadCard key={thread.id} thread={thread} index={index} now={now} selected={open === thread.id} onOpen={onOpen} preview={msgs.at(-1)} mention={member !== undefined && msgs.some(msg => isMention(msg.text, member))} />);
}

function ListEmpty({ children }: { children: ReactNode }) {
	return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/** `inChannel` drops the channel label, which the list's own header already names. */
function ThreadCard({ thread, index, now, selected, onOpen, preview, mention, inChannel }: { thread: Thread; index: BoardIndex; now: number; selected: boolean; onOpen: (id: string) => void; preview?: Message; mention?: boolean; inChannel?: boolean }) {
	const byId = index.memberById;
	const last = preview ?? index.lastByThread.get(thread.id);
	const author = last ? byId.get(last.author) : undefined;
	const unread = index.unreadByThread.get(thread.id) ?? 0;
	const people = [...new Set((index.messagesByThread.get(thread.id) ?? []).map(msg => msg.author))].slice(0, 4).flatMap(id => byId.get(id) ?? []);
	const time = <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">{last && relTime(last.at, now)}</span>;
	return (
		<button
			type="button"
			onClick={() => onOpen(thread.id)}
			aria-current={selected || undefined}
			className={cn("relative block w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/60", selected && "bg-accent hover:bg-accent")}
		>
			{unread > 0 && <span className={cn("absolute left-1.5 size-1.5 rounded-full bg-primary", inChannel ? "top-5" : "top-4.5")} />}
			{!inChannel && (
				<span className="mb-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
					<IconHashtag className="size-3" />
					{index.channelById.get(thread.channel)?.name}
					{mention && <span className="font-medium text-primary">· mentioned you</span>}
					{time}
				</span>
			)}
			<span className="flex items-baseline gap-2">
				<span className={cn("line-clamp-2 min-w-0 flex-1 text-sm leading-snug", unread > 0 ? "font-semibold" : "font-medium")}>{thread.title}</span>
				{inChannel && time}
			</span>
			{last && (
				<span className="mt-1 line-clamp-2 block text-[0.8125rem] leading-snug text-muted-foreground">
					<span className="text-foreground/80">{(last.text && feedLead(last.text)?.label) || author?.name}: </span>
					{last.text ? plainMarkdown(feedLead(last.text)?.body ?? last.text) : attachmentLabel(last.attachment)}
				</span>
			)}
			{/* One author is already named in the preview, so the row shows only a task or a conversation between several. */}
			{(thread.task || people.length > 1) && (
				<span className="mt-2 flex min-w-0 items-center gap-1.5">
					<TaskChip thread={thread} byId={byId} now={now} />
					{people.length > 1 && (
						<span className="ml-auto flex shrink-0 -space-x-1.5">
							{people.map(member => (
								<span key={member.id} className="flex rounded-full ring-2 ring-background">
									<Avatar member={member} size="sm" dot={false} />
								</span>
							))}
						</span>
					)}
				</span>
			)}
		</button>
	);
}
