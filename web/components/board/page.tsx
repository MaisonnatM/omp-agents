/** The Board: channels and threads where people, omp sessions, and remote agents post, with an inbox per member; a message for a session wakes it. */
import { IconBell, IconCalendar1, IconCheckmark1, IconChevronLeft, IconClock, IconPullRequest as IconGitPullRequest, IconHashtag, IconMagnifyingGlass, IconPlusSmall, IconRunShortcut, IconShieldCheck, IconSidebarSimpleRightWide, IconUser } from "central-icons";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { InputMessage } from "@/components/ui/input-message";
import type { MenuOption } from "../../mentions";
import { CompletionPopup } from "../completion-popup";
import type { PromptEditorHandle } from "../prompt-editor";
import type { PromptToken, Tokenize } from "../../prompt-tokens";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { hashForPage } from "../../routing";
import { type Attachment, type BoardChange, type BoardState, boardMembers, isMention, LEASE_MS, type Member, type Message, queueOf, repeatLabel, type Thread, unreadIn } from "../../../src/shared/board";
import type { CoreData } from "../module-views";
import { type BoardRoute, type BoardView, resolveBoardView } from "./module";
import { Avatar, MIN, NameDialog, relTime, UNITS, useNow } from "./parts";

const COMMANDS = [
	{ name: "review", about: "Run the review panel on this thread and post the verdict here" },
	{ name: "implement", about: "Have an agent claim this task, build it, and report back" },
	{ name: "grill", about: "Stress-test the plan in this thread with two models" },
	{ name: "schedule", about: "Post to an agent later: /schedule @name text in 10m, or every 2h" },
	{ name: "claim", about: "Take this task with a one-hour lease" },
	{ name: "done", about: "Settle this task, which opens the tasks waiting on it" },
] as const;

const WORKFLOW_STEPS: Record<string, string[]> = {
	review: ["Interface review", "Thermonuclear review", "Cross-judge (Codex)"],
	grill: ["Claude grills", "Codex grills", "Merge findings"],
	implement: ["Claim task", "Implement", "Open PR", "Report back"],
};

const lastIn = (state: BoardState, threadId: string): Message | undefined => state.messages.findLast(msg => msg.thread === threadId);

export function BoardPage({ route, core, state, onChange }: { route: BoardRoute; core: CoreData; state: BoardState | null; disabled: boolean; onChange: (change: BoardChange) => Promise<void> }) {
	if (!state) return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading the board…</div>;
	return <Board view={route.view} open={route.thread} core={core} state={state} onChange={change => void onChange(change)} />;
}

function Board({ view: asked, open, core, state, onChange }: { view: BoardView; open: string | null; core: CoreData; state: BoardState; onChange: (change: BoardChange) => void }) {
	const setOpen = (thread: string | null) => (location.hash = hashForPage({ kind: "board", view: asked, thread }));
	/** Inbox items you read this visit, which stay listed until you leave the page, as a mail inbox keeps a message you just opened. */
	const [lingering, setLingering] = useState<Message[]>([]);
	const now = useNow();

	const members = useMemo(() => boardMembers(state, core.hosts, core.bots ?? []), [state, core.hosts, core.bots]);
	const byId = useMemo(() => new Map(members.map(member => [member.id, member])), [members]);
	const view = resolveBoardView(state, byId, asked);
	const me = byId.get(state.me)!;
	const myQueue = queueOf(state, me);

	useEffect(() => {
		if (!open) return;
		const fresh = myQueue.filter(msg => msg.thread === open);
		if (fresh.length === 0) return;
		setLingering(prev => [...prev, ...fresh.filter(msg => !prev.some(kept => kept.id === msg.id))]);
		onChange({ op: "read", member: state.me, thread: open, at: Math.max(...fresh.map(msg => msg.at)) });
	}, [open, state.messages.length]);

	function post(threadId: string, text: string, extra: Partial<Message> = {}) {
		onChange({ op: "post", message: { id: crypto.randomUUID(), thread: threadId, author: state.me, at: Date.now(), text, ...extra } });
	}

	function createThread(channel: string, title: string) {
		const id = `t-${crypto.randomUUID()}`;
		onChange({ op: "thread", thread: { id, channel, title, task: null, lease: null, labels: [], blockedBy: [], createdAt: Date.now() } });
		setOpen(id);
	}

	function runCommand(threadId: string, command: string, arg: string) {
		const thread = state.threads.find(item => item.id === threadId)!;
		if (command === "claim") {
			onChange({ op: "task", thread: threadId, task: "claimed", lease: { by: state.me, until: Date.now() + LEASE_MS } });
			post(threadId, "Claimed. Lease 1h.");
		} else if (command === "done") {
			onChange({ op: "task", thread: threadId, task: "done", lease: null });
			post(threadId, arg || "Done.");
		} else if (command === "schedule") {
			const to = members.find(member => isMention(arg, member));
			if (!to) return post(threadId, "/schedule needs an @member to post to.", { internal: true });
			const every = arg.match(/\bevery (\d+)\s*([mhd])\b/);
			const after = arg.match(/\bin (\d+)\s*([mhd])\b/);
			const step = (match: RegExpMatchArray) => Number(match[1]) * UNITS[match[2]!]!;
			const repeat = every ? step(every) : null;
			const at = Date.now() + (after ? step(after) : (repeat ?? 5 * MIN));
			const text = arg.replace(`@${to.name}`, "").replace(/\b(every|in) \d+\s*[mhd]\b/g, "").trim() || "Check back on this thread.";
			onChange({ op: "schedule", schedule: { id: crypto.randomUUID(), thread: threadId, by: state.me, to: to.id, text, at, every: repeat } });
			post(threadId, `Scheduled for ${to.name}`, { internal: true, attachment: { kind: "schedule", text, at, every: repeat } });
		} else {
			// The workflow goes to the agent it mentions, else to the agent holding the task.
			const holder = thread.lease ? byId.get(thread.lease.by) : undefined;
			const target = members.find(member => member.kind !== "human" && isMention(arg, member)) ?? (holder?.kind === "human" ? undefined : holder);
			const text = `/${command}${target && !isMention(arg, target) ? ` @${target.name}` : ""}${arg ? ` ${arg}` : ""}`;
			post(threadId, text, { attachment: { kind: "workflow", command: `/${command}`, steps: WORKFLOW_STEPS[command]!.map(label => ({ label, state: "queued" })) } });
		}
	}

	function answer(messageId: string, option: string) {
		const asked = state.messages.find(msg => msg.id === messageId)!;
		onChange({ op: "answer", message: messageId, option });
		// The answer mentions who asked, which wakes them.
		post(asked.thread, `@${byId.get(asked.author)?.name ?? asked.author} ${option}.`);
	}

	const thread = state.threads.find(item => item.id === open) ?? null;
	const inboxItems = [...lingering.filter(kept => !myQueue.some(msg => msg.id === kept.id)), ...myQueue].toSorted((a, b) => b.at - a.at);
	const working = thread ? members.find(member => member.sessionId && member.presence === "working" && state.messages.some(msg => msg.thread === thread.id && msg.author === member.id)) : undefined;
	if (!thread && view.kind === "inbox" && inboxItems.length === 0)
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
	return (
		<div className="@container h-full min-h-0">
			<div className="grid h-full min-h-0 grid-cols-[minmax(14rem,26rem)_minmax(0,1fr)] max-phone:grid-cols-1 @max-[46rem]:grid-cols-1">
				{/* Too narrow for the list beside a 30rem thread: an open thread takes the page, with a way back to the list. */}
				<div className={cn("grid min-h-0 min-w-0", thread && "@max-[46rem]:hidden max-phone:hidden")}>
					<ListColumn state={state} members={members} byId={byId} view={view} open={open} onOpen={setOpen} onCreateThread={createThread} now={now} queue={inboxItems} />
				</div>
			{thread ? (
				<ThreadView
					key={thread.id}
					state={state}
					thread={thread}
					byId={byId}
					members={members}
					now={now}
					typing={working}
					onPost={text => post(thread.id, text)}
					onCommand={(command, arg) => runCommand(thread.id, command, arg)}
					onAnswer={answer}
					onOpenThread={setOpen}
					onBack={() => setOpen(null)}
				/>
			) : (
				<div className="grid place-items-center text-sm text-muted-foreground @max-[46rem]:hidden max-phone:hidden">Pick a thread</div>
			)}
			</div>
		</div>
	);
}

/* ─────────────────────────── List column ─────────────────────────── */

function ListColumn({ state, members, byId, view, open, onOpen, onCreateThread, now, queue }: { state: BoardState; members: Member[]; byId: Map<string, Member>; view: BoardView; open: string | null; onOpen: (id: string) => void; onCreateThread: (channel: string, title: string) => void; now: number; queue: Message[] }) {
	const [q, setQ] = useState("");
	const [naming, setNaming] = useState(false);
	let title = "Inbox";
	let meta = INBOX_META;
	let body: ReactNode;
	if (view.kind === "inbox") {
		const me = byId.get(state.me)!;
		const groups = Map.groupBy(queue, msg => msg.thread);
		body = groups.size === 0 ? <ListEmpty>Inbox zero. Agents will ping you here.</ListEmpty> : [...groups].map(([threadId, msgs]) => {
			const thread = state.threads.find(item => item.id === threadId)!;
			return <ThreadCard key={threadId} thread={thread} state={state} byId={byId} now={now} selected={open === threadId} onOpen={onOpen} preview={msgs.at(-1)} mention={msgs.some(msg => isMention(msg.text, me))} />;
		});
	} else if (view.kind === "scheduled") {
		title = "Scheduled";
		meta = "Messages agents get later; a repeat is a cron";
		body = state.schedules.toSorted((a, b) => a.at - b.at).map(item => {
			const to = byId.get(item.to);
			return (
				<button key={item.id} type="button" onClick={() => onOpen(item.thread)} className="flex w-full gap-3 border-b border-border px-4 py-3 text-left hover:bg-accent/60">
					{to && <Avatar member={to} size="md" />}
					<span className="min-w-0 flex-1">
						<span className="flex items-center gap-2 text-sm font-medium">
							{to?.name}
							<span className="ml-auto flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
								<IconClock className="size-3" />
								{relTime(item.at, now)}
							</span>
						</span>
						<span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{item.text}</span>
						<span className="mt-1.5 flex min-w-0 gap-1.5">
							<Chip>{item.every ? repeatLabel(item.every) : "once"}</Chip>
							<Chip>{state.threads.find(thread => thread.id === item.thread)?.title}</Chip>
						</span>
					</span>
				</button>
			);
		});
	} else if (view.kind === "channel") {
		const channel = state.channels.find(item => item.id === view.id)!;
		title = `#${channel.name}`;
		meta = channel.about;
		const threads = state.threads.filter(thread => thread.channel === channel.id && thread.title.toLowerCase().includes(q.toLowerCase())).toSorted((a, b) => (lastIn(state, b.id)?.at ?? 0) - (lastIn(state, a.id)?.at ?? 0));
		body = threads.length === 0 ? <ListEmpty>{q ? "No thread matches." : "No threads yet. Start one with New thread."}</ListEmpty> : threads.map(thread => <ThreadCard key={thread.id} thread={thread} state={state} byId={byId} now={now} selected={open === thread.id} onOpen={onOpen} />);
	} else {
		const member = byId.get(view.id)!;
		const waiting = queueOf(state, member);
		title = member.name;
		meta = member.kind === "human" ? "Person" : `${member.harness}`;
		body = (
			<>
				<div className="flex items-center gap-3 border-b border-border px-4 py-4">
					<Avatar member={member} size="md" />
					<div className="min-w-0 flex-1 text-sm">
						<p className="font-medium">{presenceLine(member)}</p>
						<p className="text-xs text-muted-foreground">{waiting.length} message{waiting.length === 1 ? "" : "s"} waiting in their inbox</p>
					</div>
				</div>
				{member.presence === "asleep" && waiting.length > 0 && (
					<div className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
						Queued. {member.name} reads these the moment its machine wakes; mentions from people and threads it holds a lease on wake it first.
					</div>
				)}
				<p className="px-4 pt-4 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Their queue</p>
				{waiting.length === 0 ? <ListEmpty>Nothing waiting.</ListEmpty> : [...Map.groupBy(waiting, msg => msg.thread)].map(([threadId, msgs]) => <ThreadCard key={threadId} thread={state.threads.find(item => item.id === threadId)!} state={state} byId={byId} now={now} selected={open === threadId} onOpen={onOpen} preview={msgs.at(-1)} mention={msgs.some(msg => isMention(msg.text, member))} />)}
			</>
		);
	}
	return (
		<section aria-label={title} className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border">
			<ListHeader
				title={title}
				meta={meta}
				action={
					view.kind === "channel" && (
						<Button size="compact" variant="outline" onClick={() => setNaming(true)}>
							<IconPlusSmall />
							New thread
						</Button>
					)
				}
			/>
			{view.kind === "channel" && (
				<label className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-sm text-muted-foreground">
					<IconMagnifyingGlass className="size-3.5" />
					<input value={q} onChange={event => setQ(event.target.value)} placeholder="Filter threads" className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
				</label>
			)}
			<div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{body}</div>
			{naming && view.kind === "channel" && <NameDialog title={`New thread in ${title}`} label="Thread title" onSave={name => onCreateThread(view.id, name)} onClose={() => setNaming(false)} />}
		</section>
	);
}

const INBOX_META = "Mentions and replies waiting for you";

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

/** Who holds a lease and for how long, or that it ran out. */
function leaseLabel(lease: NonNullable<Thread["lease"]>, byId: Map<string, Member>, now: number, sep: string) {
	const name = byId.get(lease.by)?.name ?? lease.by;
	return lease.until <= now ? `${name}${sep}lease expired` : `${name}${sep}${relTime(lease.until, now).replace("in ", "")} left`;
}

function presenceLine(member: Member) {
	return { working: "Working now", idle: "Idle, will pick up new messages", asking: "Waiting on an answer", asleep: "Asleep, messages queue", online: "Online", away: "Away" }[member.presence];
}

function ListEmpty({ children }: { children: ReactNode }) {
	return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

function Chip({ children, tone }: { children: ReactNode; tone?: "blue" | "green" | "amber" | "red" | "violet" }) {
	const tones = { blue: "bg-sky-500/12 text-sky-700 dark:text-sky-300", green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300", red: "bg-red-500/12 text-red-700 dark:text-red-300", violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300" };
	return <span className={cn("inline-block h-5 min-w-0 truncate rounded px-1.5 text-2xs leading-5 font-medium", tone ? tones[tone] : "bg-foreground/[0.06] text-muted-foreground")}>{children}</span>;
}

const TASK_TONE = { open: "blue", claimed: "violet", review: "amber", done: "green", blocked: "red" } as const;

function TaskChip({ thread, byId, now }: { thread: Thread; byId: Map<string, Member>; now: number }) {
	if (!thread.task) return null;
	const label = thread.task === "claimed" && thread.lease && byId.has(thread.lease.by) ? leaseLabel(thread.lease, byId, now, " · ") : thread.task;
	return <Chip tone={TASK_TONE[thread.task]}>{label}</Chip>;
}

function ThreadCard({ thread, state, byId, now, selected, onOpen, preview, mention }: { thread: Thread; state: BoardState; byId: Map<string, Member>; now: number; selected: boolean; onOpen: (id: string) => void; preview?: Message; mention?: boolean }) {
	const last = preview ?? lastIn(state, thread.id);
	const author = last ? byId.get(last.author) : undefined;
	const unread = unreadIn(state, thread.id);
	const people = [...new Set(state.messages.filter(msg => msg.thread === thread.id).map(msg => msg.author))].slice(0, 4).flatMap(id => byId.get(id) ?? []);
	const channel = state.channels.find(item => item.id === thread.channel)!;
	return (
		<button
			type="button"
			onClick={() => onOpen(thread.id)}
			aria-current={selected || undefined}
			className={cn("relative block w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/60", selected && "bg-accent hover:bg-accent")}
		>
			{unread > 0 && <span className="absolute top-4.5 left-1.5 size-1.5 rounded-full bg-primary" />}
			<span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
				<IconHashtag className="size-3" />
				{channel.name}
				{mention && <span className="font-medium text-primary">· mentioned you</span>}
				<span className="ml-auto tabular-nums">{last && relTime(last.at, now)}</span>
			</span>
			<span className={cn("mt-1 line-clamp-2 block text-sm leading-snug", unread > 0 ? "font-semibold" : "font-medium")}>{thread.title}</span>
			{last && (
				<span className="mt-1 line-clamp-2 block text-[0.8125rem] leading-snug text-muted-foreground">
					<span className="text-foreground/80">{author?.name}: </span>
					{last.text || attachmentLabel(last.attachment)}
				</span>
			)}
			<span className="mt-2 flex min-w-0 items-center gap-1.5">
				<TaskChip thread={thread} byId={byId} now={now} />
				{thread.labels.slice(0, 2).map(label => (
					<Chip key={label}>{label}</Chip>
				))}
				<span className="ml-auto flex shrink-0 -space-x-1.5">
					{people.map(member => (
						<span key={member.id} className="flex rounded-full ring-2 ring-background">
							<Avatar member={member} size="sm" dot={false} />
						</span>
					))}
				</span>
			</span>
		</button>
	);
}

function attachmentLabel(attachment?: Attachment) {
	if (!attachment) return "";
	return { pr: "Opened a pull request", finding: "Posted a finding", workflow: "Ran a workflow", schedule: "Scheduled a follow-up", question: "Asked a question" }[attachment.kind];
}

/* ─────────────────────────── Thread view ─────────────────────────── */

interface ThreadViewProps {
	state: BoardState;
	thread: Thread;
	byId: Map<string, Member>;
	members: Member[];
	now: number;
	typing?: Member;
	onPost: (text: string) => void;
	onCommand: (command: string, arg: string) => void;
	onAnswer: (msgId: string, option: string) => void;
	onOpenThread: (id: string) => void;
	/** Back to the list, which the narrow page hides while a thread is open. */
	onBack: () => void;
}

function ThreadView({ state, thread, byId, members, now, typing, onPost, onCommand, onAnswer, onOpenThread, onBack }: ThreadViewProps) {
	const messages = state.messages.filter(msg => msg.thread === thread.id);
	const channel = state.channels.find(item => item.id === thread.channel)!;
	const scroller = useRef<HTMLDivElement>(null);
	const [showInternal, setShowInternal] = useState(true);
	const [details, setDetails] = useState(false);
	/** Whether the reader is at the latest message, so the list follows new ones and any resize, as the composer lifting over a toast. */
	const pinned = useRef(true);
	useEffect(() => {
		const list = scroller.current!;
		list.scrollTop = list.scrollHeight;
		const onScroll = () => (pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48);
		const follow = new ResizeObserver(() => {
			if (pinned.current) list.scrollTop = list.scrollHeight;
		});
		follow.observe(list);
		if (list.firstElementChild) follow.observe(list.firstElementChild);
		list.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			follow.disconnect();
			list.removeEventListener("scroll", onScroll);
		};
	}, []);
	useEffect(() => {
		if (pinned.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
	}, [messages.length, typing]);
	const deps = thread.blockedBy.map(id => state.threads.find(item => item.id === id)!);
	const dependents = state.threads.filter(item => item.blockedBy.includes(thread.id));
	const shown = showInternal ? messages : messages.filter(msg => !msg.internal);
	const schedules = state.schedules.filter(item => item.thread === thread.id);

	return (
		<section aria-label={thread.title} className="flex min-h-0 min-w-0 flex-col">
			<header className="flex h-(--page-header-height) shrink-0 items-center gap-3 border-b border-border px-6">
				<Button variant="ghost" size="icon-compact" aria-label="Back to list" className="-ml-2 shrink-0 @min-[46rem]:hidden max-phone:inline-flex" onClick={onBack}>
					<IconChevronLeft />
				</Button>
				<div className="min-w-0 flex-1">
					<h2 title={thread.title} className="truncate text-sm font-semibold">{thread.title}</h2>
					<p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
						<IconHashtag className="size-3" />
						{channel.name}
						{channel.sync && <span>· synced to {channel.sync}</span>}
					</p>
				</div>
				<TaskChip thread={thread} byId={byId} now={now} />
				<label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
					<input type="checkbox" checked={showInternal} onChange={event => setShowInternal(event.target.checked)} className="accent-current" />
					Internal notes
				</label>
				<Button variant="ghost" size="icon-compact" aria-label="Details" aria-expanded={details} className="-mr-2 shrink-0 min-[1400px]:hidden" onClick={() => setDetails(open => !open)}>
					<IconSidebarSimpleRightWide />
				</Button>
			</header>
			<div className="relative flex min-h-0 flex-1">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
					<ol className="mx-auto max-w-3xl px-6 py-6">
						{shown.map((msg, i) => {
							const prev = shown[i - 1];
							const grouped = prev && prev.author === msg.author && msg.at - prev.at < 10 * 60_000;
							return <MessageRow key={msg.id} msg={msg} author={byId.get(msg.author)} grouped={!!grouped} now={now} onAnswer={onAnswer} me={state.me} />;
						})}
						{typing && (
							<li className="flex items-center gap-3 pt-4 text-xs text-muted-foreground">
								<Avatar member={typing} size="md" />
								<span className="flex items-center gap-1.5">
									<span className="flex gap-0.5">
										{[0, 1, 2].map(n => (
											<span key={n} className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-bounce" style={{ animationDelay: `${n * 120}ms` }} />
										))}
									</span>
									{typing.name} is replying
								</span>
							</li>
						)}
					</ol>
				</div>
				<Composer members={members} onPost={onPost} onCommand={onCommand} channel={channel.name} />
				</div>
				<aside
					aria-label="Details"
					className={cn(
						"w-64 shrink-0 overflow-y-auto border-l border-border bg-background px-4 py-5 text-sm",
						details ? "max-[1400px]:absolute max-[1400px]:inset-y-0 max-[1400px]:right-0 max-[1400px]:z-20 max-[1400px]:shadow-lg" : "max-[1400px]:hidden",
					)}
				>
					<SideHeading>Task</SideHeading>
					<div className="space-y-2">
						<Fact label="State">
							<span className="capitalize">{thread.task ?? "Discussion"}</span>
						</Fact>
						{thread.lease && <Fact label="Lease">{leaseLabel(thread.lease, byId, now, ", ")}</Fact>}
						<Fact label="Labels">{thread.labels.join(", ")}</Fact>
					</div>
					{(deps.length > 0 || dependents.length > 0) && (
						<>
							<SideHeading>Dependencies</SideHeading>
							{deps.map(dep => (
								<DepRow key={dep.id} label="Waits on" thread={dep} onOpen={onOpenThread} />
							))}
							{dependents.map(dep => (
								<DepRow key={dep.id} label="Unblocks" thread={dep} onOpen={onOpenThread} />
							))}
						</>
					)}
					<SideHeading>In this thread</SideHeading>
					<ul className="space-y-2">
						{[...new Set(messages.map(msg => msg.author))].flatMap(id => byId.get(id) ?? []).map(member => (
							<li key={member.id} className="flex items-center gap-2">
								<Avatar member={member} size="sm" />
								<span className="min-w-0 flex-1 truncate">{member.name}</span>
								<span className="text-3xs text-muted-foreground">{member.kind}</span>
							</li>
						))}
					</ul>
					{schedules.length > 0 && (
						<>
							<SideHeading>Scheduled</SideHeading>
							{schedules.map(item => (
								<div key={item.id} className="mb-2 rounded-md border border-border p-2 text-xs">
									<p className="flex items-center gap-1 text-muted-foreground">
										<IconClock className="size-3" />
										{relTime(item.at, now)} · {item.every ? repeatLabel(item.every) : "once"} · {byId.get(item.to)?.name}
									</p>
									<p className="mt-1">{item.text}</p>
								</div>
							))}
						</>
					)}
				</aside>
			</div>
		</section>
	);
}

function SideHeading({ children }: { children: ReactNode }) {
	return <p className="mt-5 mb-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase first:mt-0">{children}</p>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<p className="flex gap-2 text-xs">
			<span className="w-14 shrink-0 text-muted-foreground">{label}</span>
			<span className="min-w-0">{children}</span>
		</p>
	);
}

function DepRow({ label, thread, onOpen }: { label: string; thread: Thread; onOpen: (id: string) => void }) {
	return (
		<button type="button" onClick={() => onOpen(thread.id)} className="mb-1.5 block w-full rounded-md border border-border p-2 text-left text-xs hover:bg-accent">
			<span className="text-muted-foreground">{label}</span>
			<span className="mt-0.5 line-clamp-2 block">{thread.title}</span>
			{thread.task && (
				<span className="mt-1 block">
					<Chip tone={TASK_TONE[thread.task]}>{thread.task}</Chip>
				</span>
			)}
		</button>
	);
}

function MessageRow({ msg, author, grouped, now, onAnswer, me }: { msg: Message; author?: Member; grouped: boolean; now: number; onAnswer: (id: string, option: string) => void; me: string }) {
	return (
		<li className={cn("group flex gap-3 rounded-lg px-2 -mx-2", grouped ? "pt-1" : "pt-4", msg.internal && "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,color-mix(in_oklab,var(--muted)_60%,transparent)_6px,color-mix(in_oklab,var(--muted)_60%,transparent)_7px)]")}>
			<span className="w-8 shrink-0">{!grouped && author && <Avatar member={author} size="md" />}</span>
			<div className="min-w-0 flex-1 pb-1">
				{!grouped && (
					<p className="flex items-baseline gap-2">
						<span className="text-sm font-semibold">{author?.name ?? "unknown"}</span>
						{author && author.kind !== "human" && <span className="rounded bg-foreground/[0.06] px-1 text-3xs text-muted-foreground">{author.harness}</span>}
						<time className="text-2xs tabular-nums text-muted-foreground">{relTime(msg.at, now)}</time>
						{msg.internal && <span className="text-3xs font-medium text-muted-foreground">internal · not synced</span>}
						{msg.synced && <span className="text-3xs text-muted-foreground">via {msg.synced}</span>}
					</p>
				)}
				{msg.text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{renderText(msg.text, msg.author === me)}</p>}
				{msg.attachment && <AttachmentCard attachment={msg.attachment} now={now} onAnswer={option => onAnswer(msg.id, option)} />}
			</div>
		</li>
	);
}

function renderText(text: string, mine: boolean): ReactNode {
	return text.split(/(@[\p{L}'][\p{L}'\- ]*?(?=[\s,.?!:]|$)|`[^`]+`|\/[a-z]+\b)/u).map((part, i) => {
		if (part.startsWith("@")) return <span key={i} className={cn("rounded px-0.5 font-medium", mine ? "bg-primary/10 text-primary" : "bg-amber-500/15 text-amber-800 dark:text-amber-300")}>{part}</span>;
		if (part.startsWith("`")) return <code key={i} className="rounded bg-muted px-1 font-mono text-[0.8em]">{part.slice(1, -1)}</code>;
		if (/^\/[a-z]+$/.test(part) && COMMANDS.some(command => `/${command.name}` === part)) return <span key={i} className="font-mono text-[0.85em] font-medium text-violet-700 dark:text-violet-300">{part}</span>;
		return part;
	});
}

function AttachmentCard({ attachment, now, onAnswer }: { attachment: Attachment; now: number; onAnswer: (option: string) => void }) {
	const frame = "mt-2 max-w-xl rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]";
	switch (attachment.kind) {
		case "pr": {
			const checks = { passing: ["green", "Checks passing"], failing: ["red", "Checks failing"], running: ["amber", "Checks running"] } as const;
			return (
				<div className={cn(frame, "flex items-start gap-3 p-3")}>
					<span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", attachment.state === "merged" ? "bg-violet-500/12 text-violet-600" : "bg-emerald-500/12 text-emerald-600")}>
						<IconGitPullRequest className="size-4" />
					</span>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium">{attachment.title}</p>
						<p className="text-xs text-muted-foreground">
							{attachment.repo} #{attachment.number}
						</p>
						<p className="mt-2 flex gap-1.5">
							<Chip tone={attachment.state === "merged" ? "violet" : "green"}>{attachment.state}</Chip>
							<Chip tone={checks[attachment.checks][0]}>{checks[attachment.checks][1]}</Chip>
						</p>
					</div>
				</div>
			);
		}
		case "finding": {
			const tone = { low: "blue", medium: "amber", high: "red", critical: "red" } as const;
			return (
				<div className={cn(frame, "overflow-hidden")}>
					<div className="flex items-center gap-2 border-b border-border bg-red-500/[0.04] px-3 py-2 text-xs">
						<IconShieldCheck className="size-3.5 text-red-600" />
						<span className="font-medium">security-finding@1</span>
						<span className="ml-auto">
							<Chip tone={tone[attachment.severity]}>{attachment.severity}</Chip>
						</span>
					</div>
					<dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 px-3 py-2.5 text-xs">
						<dt className="text-muted-foreground">Repository</dt>
						<dd>{attachment.repo}</dd>
						<dt className="text-muted-foreground">File</dt>
						<dd className="font-mono text-[0.95em]">{attachment.file}</dd>
						<dt className="text-muted-foreground">Summary</dt>
						<dd>{attachment.summary}</dd>
					</dl>
				</div>
			);
		}
		case "workflow":
			return (
				<div className={cn(frame, "p-3")}>
					<p className="mb-2 flex items-center gap-2 text-xs">
						<span className="font-mono font-medium text-violet-700 dark:text-violet-300">{attachment.command}</span>
						<span className="text-muted-foreground">{attachment.steps.every(step => step.state === "done") ? "finished" : "running"}</span>
					</p>
					<ol className="space-y-1.5">
						{attachment.steps.map(step => (
							<li key={step.label} className="flex items-center gap-2 text-sm">
								<StepDot state={step.state} />
								<span className={cn(step.state === "queued" && "text-muted-foreground")}>{step.label}</span>
							</li>
						))}
					</ol>
				</div>
			);
		case "schedule":
			return (
				<div className={cn(frame, "flex items-center gap-3 p-3 text-sm")}>
					<IconCalendar1 className="size-4 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">{attachment.text}</span>
					<Chip>{attachment.every ? repeatLabel(attachment.every) : relTime(attachment.at, now)}</Chip>
				</div>
			);
		case "question":
			return (
				<div className="mt-2 flex flex-wrap gap-2">
					{attachment.options.map(option => (
						<button
							key={option}
							type="button"
							disabled={attachment.picked !== null}
							onClick={() => onAnswer(option)}
							className={cn(
								"h-8 rounded-lg border border-border px-3 text-sm transition-colors enabled:hover:bg-accent disabled:opacity-50",
								attachment.picked === option && "border-primary bg-primary/10 text-primary disabled:opacity-100",
							)}
						>
							{attachment.picked === option && <IconCheckmark1 className="mr-1 inline size-3.5" />}
							{option}
						</button>
					))}
				</div>
			);
	}
}

function StepDot({ state }: { state: "done" | "running" | "queued" | "failed" }) {
	if (state === "done")
		return (
			<span className="grid size-4 place-items-center rounded-full bg-emerald-500 text-white">
				<IconCheckmark1 className="size-2.5" />
			</span>
		);
	if (state === "running") return <span className="size-4 rounded-full border-2 border-sky-500 border-t-transparent motion-safe:animate-spin" />;
	if (state === "failed") return <span className="size-4 rounded-full bg-red-500" />;
	return <span className="size-4 rounded-full border border-dashed border-muted-foreground/50" />;
}

/* ─────────────────────────── Composer ─────────────────────────── */

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Board message's chips: `@` and a member's name, and a workflow command at the start. */
function boardTokens(members: Member[]): Tokenize {
	const names = members.map(member => member.name).sort((a, b) => b.length - a.length);
	const mention = names.length ? new RegExp(`(?<=^|\\s)@(${names.map(escape).join("|")})(?=\\s|$)`, "gu") : null;
	const command = new RegExp(`^/(${COMMANDS.map(item => item.name).join("|")})(?=\\s|$)`, "g");
	return (text, { open = null, leading = true } = {}) => {
		const found: PromptToken[] = [];
		const scan = (re: RegExp, token: (match: RegExpExecArray) => Pick<PromptToken, "kind" | "label" | "target">) => {
			for (const match of text.matchAll(re)) {
				const end = match.index + match[0].length;
				if (end !== open) found.push({ ...token(match), start: match.index, end });
			}
		};
		if (leading) scan(command, match => ({ kind: "command", label: match[1]!, target: match[1]! }));
		if (mention) scan(mention, match => ({ kind: "person", label: `@${match[1]}`, target: members.find(member => member.name === match[1])!.id }));
		return found.sort((a, b) => a.start - b.start);
	};
}

function Composer({ members, onPost, onCommand, channel }: { members: Member[]; onPost: (text: string) => void; onCommand: (command: string, arg: string) => void; channel: string }) {
	const [text, setText] = useState("");
	const [active, setActive] = useState(0);
	const [closed, setClosed] = useState(false);
	const editorRef = useRef<PromptEditorHandle>(null);
	const listId = useId();
	const token = text.match(/(?:^|\s)([@/])([\p{L}'\- ]{0,20})$/u);
	const head = token ? text.slice(0, text.length - token[2]!.length - 1) : text;
	const option = (icon: MenuOption["icon"], label: string, detail: string | null, inserted: string): MenuOption => ({ icon, label, detail, edit: { text: `${head}${inserted} `, cursor: head.length + inserted.length + 1 }, opens: false });
	const tokenize = useMemo(() => boardTokens(members), [members]);
	const options: MenuOption[] =
		!token || closed
			? []
			: token[1] === "@"
				? members
						.filter(member => member.name.toLowerCase().startsWith(token[2]!.toLowerCase()))
						.slice(0, 6)
						.map(member => option(IconUser, member.name, member.presence === "asleep" ? "queues until it wakes" : member.kind === "human" ? "person" : (member.harness ?? null), `@${member.name}`))
				: text.trimStart().startsWith("/") && !text.includes(" ")
					? COMMANDS.filter(command => command.name.startsWith(token[2]!)).map(command => option(IconRunShortcut, `/${command.name}`, command.about, `/${command.name}`))
					: [];

	function change(value: string) {
		setText(value);
		setActive(0);
		setClosed(false);
	}

	function insert(edit: MenuOption["edit"]) {
		change(edit.text);
		requestAnimationFrame(() => editorRef.current?.select(edit.cursor));
	}

	function send(value: string) {
		const trimmed = value.trim();
		if (!trimmed) return;
		const command = trimmed.match(/^\/([a-z]+)\s*(.*)$/s);
		if (command && COMMANDS.some(item => item.name === command[1])) onCommand(command[1]!, command[2]!);
		else onPost(trimmed);
		change("");
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (options.length === 0 || event.nativeEvent.isComposing) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setActive(i => (i + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
		} else if ((event.key === "Tab" && !event.shiftKey) || event.key === "Enter") {
			event.preventDefault();
			insert(options[active]!.edit);
		} else if (event.key === "Escape") {
			event.preventDefault();
			setClosed(true);
		}
	}

	return (
		<div className="shrink-0 pt-2 pb-[max(1.25rem,var(--toasts-clearance,0px))] transition-[padding] duration-200 max-phone:pb-5">
			<div className="relative mx-auto max-w-3xl px-6">
				{options.length > 0 && <CompletionPopup id={listId} sections={[{ title: null, options }]} active={active} onPick={picked => insert(picked.edit)} error={null} />}
				<InputMessage
					editorRef={editorRef}
					value={text}
					onValueChange={change}
					onSend={send}
					tokenize={tokenize}
					minRows={2}
					placeholder={`Reply in #${channel}. @ to ping a person or agent, / for a workflow`}
					editorProps={{
						onKeyDown,
						"aria-controls": options.length > 0 ? listId : undefined,
						"aria-activedescendant": options.length > 0 ? `${listId}-${active}` : undefined,
					}}
					leftSlot={(["review", "implement", "schedule"] as const).map(name => (
						<button key={name} type="button" onClick={() => insert({ text: `/${name} `, cursor: name.length + 2 })} className="h-7 rounded-md px-2 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
							/{name}
						</button>
					))}
				/>
			</div>
		</div>
	);
}
