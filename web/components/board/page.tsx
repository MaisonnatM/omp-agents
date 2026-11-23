/** The Board prototype: one place where people, local sessions, and remote agents post in channels and threads, with an inbox per member that wakes them. */
import {
	IconArrowUp,
	IconBell,
	IconBubble2,
	IconCalendar1,
	IconCheckmark1,
	IconClock,
	IconPullRequest as IconGitPullRequest,
	IconHashtag,
	IconLock,
	IconMagnifyingGlass,
	IconShieldCheck,
} from "central-icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BotAvatar } from "../bots/bot-avatar";
import type { CoreData } from "../module-views";
import type { BoardRoute } from "./module";
import {
	type Attachment,
	type BoardState,
	COMMANDS,
	type Member,
	type Message,
	type Thread,
	isMention,
	lastMessage,
	markRead,
	mentionsOf,
	newId,
	queueOf,
	relTime,
	seed,
	sessionMembers,
	STORAGE_KEY,
	unreadIn,
} from "./model";

function load(): BoardState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as BoardState;
			if (parsed.version === 1) return parsed;
		}
	} catch {}
	return seed(Date.now());
}

function useNow(ms = 15_000) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(id);
	}, [ms]);
	return now;
}

type View = { kind: "inbox" } | { kind: "scheduled" } | { kind: "channel"; id: string } | { kind: "member"; id: string };

export function BoardPage({ core }: { route: BoardRoute; core: CoreData }) {
	const [state, setState] = useState(load);
	const [view, setView] = useState<View>({ kind: "inbox" });
	const [open, setOpen] = useState<string | null>("t-auth");
	const [typing, setTyping] = useState<Record<string, string>>({});
	/** Inbox items you read this visit, which stay listed until you leave the page, as a mail inbox keeps a message you just opened. */
	const [lingering, setLingering] = useState<Message[]>([]);
	const now = useNow();
	useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), [state]);

	const members = useMemo(() => [...state.extraMembers, ...sessionMembers(core.hosts)], [state.extraMembers, core.hosts]);
	const byId = useMemo(() => new Map(members.map(member => [member.id, member])), [members]);
	const me = byId.get(state.me)!;

	useEffect(() => {
		if (!open) return;
		const fresh = queueOf(state, members, state.me).filter(msg => msg.thread === open);
		if (fresh.length === 0) return;
		setLingering(prev => [...prev, ...fresh.filter(msg => !prev.some(kept => kept.id === msg.id))]);
		setState(prev => markRead(prev, prev.me, open, Date.now()));
	}, [open, state.messages.length]);

	function post(threadId: string, text: string, extra: Partial<Message> = {}) {
		const msg: Message = { id: newId("m"), thread: threadId, author: state.me, at: Date.now(), text, ...extra };
		setState(prev => markRead({ ...prev, messages: [...prev.messages, msg] }, prev.me, threadId, msg.at));
		for (const agent of mentionsOf(text, members).filter(member => member.kind !== "human")) {
			if (agent.presence === "asleep") continue;
			setTimeout(() => setTyping(prev => ({ ...prev, [threadId]: agent.id })), 500);
			setTimeout(() => {
				setTyping(prev => {
					const { [threadId]: _, ...rest } = prev;
					return rest;
				});
				const reply: Message = { id: newId("m"), thread: threadId, author: agent.id, at: Date.now(), text: agentReply(text, agent) };
				setState(prev => ({ ...prev, messages: [...prev.messages, reply] }));
			}, 2200);
		}
	}

	function runCommand(threadId: string, command: string, arg: string) {
		const thread = state.threads.find(item => item.id === threadId)!;
		if (command === "claim") {
			setThread(threadId, { task: "claimed", lease: { by: state.me, until: Date.now() + 3_600_000 } });
			post(threadId, "Claimed. Lease 1h.");
		} else if (command === "done") {
			setThread(threadId, { task: "done", lease: null });
			post(threadId, arg || "Done.");
		} else if (command === "schedule") {
			const to = mentionsOf(arg, members)[0] ?? byId.get("a-factory")!;
			const at = Date.now() + 5 * 60_000;
			setState(prev => ({ ...prev, schedules: [...prev.schedules, { id: newId("s"), thread: threadId, to: to.id, text: arg.replace(`@${to.name}`, "").trim() || "Check back on this thread.", at, every: null }] }));
			post(threadId, `Scheduled for @${to.name}`, { internal: true, attachment: { kind: "schedule", text: arg || "Check back on this thread.", at, every: null } });
		} else {
			const steps = command === "review" ? ["Interface review", "Thermonuclear review", "Cross-judge (Codex)"] : command === "grill" ? ["Claude grills", "Codex grills", "Merge findings"] : ["Claim task", "Implement", "Open PR", "Report back"];
			const id = newId("m");
			const msg: Message = { id, thread: threadId, author: state.me, at: Date.now(), text: `/${command}${arg ? ` ${arg}` : ""}`, attachment: { kind: "workflow", command: `/${command}`, steps: steps.map((label, i) => ({ label, state: i === 0 ? "running" : "queued" })) } };
			setState(prev => ({ ...prev, messages: [...prev.messages, msg] }));
			steps.forEach((_, i) =>
				setTimeout(
					() =>
						setState(prev => ({
							...prev,
							messages: prev.messages.map(item =>
								item.id === id && item.attachment?.kind === "workflow" ? { ...item, attachment: { ...item.attachment, steps: item.attachment.steps.map((step, j) => ({ ...step, state: j <= i ? "done" : j === i + 1 ? "running" : "queued" })) } } : item,
							),
						})),
					1400 * (i + 1),
				),
			);
			if (thread.task === "open" && command === "implement") setThread(threadId, { task: "claimed", lease: { by: "a-factory", until: Date.now() + 3_600_000 } });
		}
	}

	function setThread(id: string, patch: Partial<Thread>) {
		setState(prev => {
			const threads = prev.threads.map(thread => (thread.id === id ? { ...thread, ...patch } : thread));
			// A task's dependents open once it is done.
			const settled = new Set(threads.filter(thread => thread.task === "done").map(thread => thread.id));
			return { ...prev, threads: threads.map(thread => (thread.task === "blocked" && thread.blockedBy.every(dep => settled.has(dep)) ? { ...thread, task: "open" } : thread)) };
		});
	}

	function answer(msgId: string, option: string) {
		const msg = state.messages.find(item => item.id === msgId)!;
		setState(prev => ({ ...prev, messages: prev.messages.map(item => (item.id === msgId && item.attachment?.kind === "question" ? { ...item, attachment: { ...item.attachment, picked: option } } : item)) }));
		const asker = byId.get(msg.author);
		post(msg.thread, `@${asker?.name ?? "agent"} ${option}.`);
	}

	const thread = state.threads.find(item => item.id === open) ?? null;
	const myQueue = queueOf(state, members, state.me);
	const inboxItems = [...lingering.filter(kept => !myQueue.some(msg => msg.id === kept.id)), ...myQueue].toSorted((a, b) => b.at - a.at);

	return (
		<div className="grid h-full min-h-0 grid-cols-[15rem_minmax(20rem,26rem)_minmax(0,1fr)] max-phone:grid-cols-1">
			<Rail state={state} members={members} view={view} onView={setView} me={me} now={now} inboxCount={myQueue.length} />
			<ListColumn state={state} members={members} byId={byId} view={view} open={open} onOpen={setOpen} now={now} queue={inboxItems} />
			{thread ? (
				<ThreadView
					key={thread.id}
					state={state}
					thread={thread}
					byId={byId}
					members={members}
					now={now}
					typing={typing[thread.id] ? byId.get(typing[thread.id]!) : undefined}
					onPost={text => post(thread.id, text)}
					onCommand={(command, arg) => runCommand(thread.id, command, arg)}
					onAnswer={answer}
					onOpenThread={setOpen}
				/>
			) : (
				<div className="grid place-items-center text-sm text-muted-foreground">Pick a thread</div>
			)}
		</div>
	);
}

function agentReply(text: string, agent: Member): string {
	if (/review|look/i.test(text)) return "On it. I'll post the verdict here when both reviewers finish.";
	if (/\?/.test(text)) return "Short answer: yes, with one caveat. Writing it up in this thread now.";
	return `Got it, picking this up. ${agent.sessionId ? "Queued for my next turn." : "Lease taken for 1h."}`;
}

/* ───────────────────────────── Rail ───────────────────────────── */

function Rail({ state, members, view, onView, me, now, inboxCount }: { state: BoardState; members: Member[]; view: View; onView: (view: View) => void; me: Member; now: number; inboxCount: number }) {
	const sel = (other: View) => view.kind === other.kind && ("id" in view ? "id" in other && view.id === other.id : true);
	const humans = members.filter(member => member.kind === "human");
	const agents = members.filter(member => member.kind !== "human");
	return (
		<nav aria-label="Board" className="flex min-h-0 flex-col border-r border-border bg-sidebar/40 max-phone:hidden">
			<div className="flex h-(--page-header-height) shrink-0 items-center gap-2.5 border-b border-border px-4">
				<span className="grid size-6 place-items-center rounded-md bg-foreground text-background">
					<IconBubble2 className="size-3.5" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold leading-tight">Board</p>
					<p className="truncate text-2xs text-muted-foreground">
						{members.filter(member => member.presence === "working").length} working · {members.length} members
					</p>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
				<RailRow icon={<IconBell className="size-4" />} label="Inbox" count={inboxCount} accent selected={sel({ kind: "inbox" })} onClick={() => onView({ kind: "inbox" })} />
				<RailRow
					icon={<IconCalendar1 className="size-4" />}
					label="Scheduled"
					hint={relTime(Math.min(...state.schedules.map(item => item.at)), now)}
					selected={sel({ kind: "scheduled" })}
					onClick={() => onView({ kind: "scheduled" })}
				/>
				<RailHeading>Channels</RailHeading>
				{state.channels.map(channel => {
					const unread = state.threads.filter(thread => thread.channel === channel.id).reduce((sum, thread) => sum + unreadIn(state, thread.id), 0);
					return (
						<RailRow
							key={channel.id}
							icon={channel.restricted ? <IconLock className="size-3.5" /> : <IconHashtag className="size-3.5" />}
							label={channel.name}
							count={unread}
							bold={unread > 0}
							trailing={channel.sync && <SyncDot sync={channel.sync} />}
							selected={sel({ kind: "channel", id: channel.id })}
							onClick={() => onView({ kind: "channel", id: channel.id })}
						/>
					);
				})}
				<RailHeading>People</RailHeading>
				{humans.map(member => (
					<MemberRow key={member.id} member={member} isMe={member.id === me.id} queued={queueOf(state, members, member.id).length} selected={sel({ kind: "member", id: member.id })} onClick={() => onView({ kind: "member", id: member.id })} />
				))}
				<RailHeading>Agents</RailHeading>
				{agents.map(member => (
					<MemberRow key={member.id} member={member} queued={queueOf(state, members, member.id).length} selected={sel({ kind: "member", id: member.id })} onClick={() => onView({ kind: "member", id: member.id })} />
				))}
			</div>
		</nav>
	);
}

function RailHeading({ children }: { children: ReactNode }) {
	return <p className="mt-4 mb-1 px-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase">{children}</p>;
}

function RailRow({ icon, label, count = 0, hint, accent, bold, trailing, selected, onClick }: { icon: ReactNode; label: string; count?: number; hint?: string; accent?: boolean; bold?: boolean; trailing?: ReactNode; selected: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={selected || undefined}
			className={cn(
				"flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
				selected && "bg-accent text-foreground",
				bold && "font-medium text-foreground",
			)}
		>
			<span className="grid size-4 shrink-0 place-items-center">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{trailing}
			{hint && <span className="text-2xs tabular-nums text-muted-foreground">{hint}</span>}
			{count > 0 && <span className={cn("min-w-5 rounded-full px-1.5 text-center text-2xs font-semibold tabular-nums leading-5", accent ? "bg-primary text-primary-foreground" : "bg-foreground/10 text-foreground")}>{count}</span>}
		</button>
	);
}

function MemberRow({ member, isMe, queued, selected, onClick }: { member: Member; isMe?: boolean; queued: number; selected: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={selected || undefined}
			className={cn("group flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent", selected && "bg-accent")}
		>
			<Avatar member={member} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm leading-tight">
					{member.name}
					{isMe && <span className="text-muted-foreground"> (you)</span>}
				</span>
				<span className="block truncate text-3xs leading-tight text-muted-foreground">{member.kind === "human" ? (member.presence === "online" ? "Online" : "Away") : member.harness}</span>
			</span>
			{queued > 0 && (
				<span title={`${queued} waiting in ${member.name}'s inbox`} className={cn("rounded px-1 text-3xs font-medium tabular-nums leading-4", member.presence === "asleep" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-foreground/10")}>
					{queued}
				</span>
			)}
		</button>
	);
}

const PRESENCE_COLOR: Record<Member["presence"], string> = {
	working: "bg-sky-500",
	idle: "bg-emerald-500",
	online: "bg-emerald-500",
	asking: "bg-amber-500",
	away: "bg-zinc-400",
	asleep: "bg-zinc-400",
};

function Avatar({ member, size }: { member: Member; size: "sm" | "md" }) {
	const box = size === "sm" ? "size-6" : "size-8";
	return (
		<span className={cn("relative inline-flex shrink-0", box)}>
			{member.kind === "human" ? (
				<span
					className={cn("grid size-full place-items-center rounded-full text-[0.7rem] font-semibold text-white", size === "md" && "text-xs")}
					style={{ background: `oklch(0.62 0.13 ${member.look.hue})` }}
				>
					{member.initials}
				</span>
			) : (
				<BotAvatar look={member.look} size={size === "sm" ? "header" : "row"} working={member.presence === "working"} className={size === "md" ? "size-8" : undefined} />
			)}
			<span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background", PRESENCE_COLOR[member.presence], member.presence === "working" && "motion-safe:animate-pulse")} />
		</span>
	);
}

function SyncDot({ sync }: { sync: "slack" | "github" | "linear" }) {
	return <span title={`Two-way sync with ${sync}`} className="rounded border border-border px-1 text-3xs leading-4 text-muted-foreground">{sync}</span>;
}

/* ─────────────────────────── List column ─────────────────────────── */

function ListColumn({ state, members, byId, view, open, onOpen, now, queue }: { state: BoardState; members: Member[]; byId: Map<string, Member>; view: View; open: string | null; onOpen: (id: string) => void; now: number; queue: Message[] }) {
	const [q, setQ] = useState("");
	let title = "Inbox";
	let meta = "Mentions and replies waiting for you";
	let body: ReactNode;
	if (view.kind === "inbox") {
		const me = byId.get(state.me)!;
		const groups = Map.groupBy(queue, msg => msg.thread);
		body = groups.size === 0 ? <Empty>Inbox zero. Agents will ping you here.</Empty> : [...groups].map(([threadId, msgs]) => {
			const thread = state.threads.find(item => item.id === threadId)!;
			return <ThreadCard key={threadId} thread={thread} state={state} byId={byId} now={now} selected={open === threadId} onOpen={onOpen} preview={msgs.at(-1)} mention={msgs.some(msg => isMention(msg, me))} />;
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
						<span className="mt-1.5 flex gap-1.5">
							<Chip>{item.every ?? "once"}</Chip>
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
		const threads = state.threads.filter(thread => thread.channel === channel.id && thread.title.toLowerCase().includes(q.toLowerCase())).toSorted((a, b) => (lastMessage(state, b.id)?.at ?? 0) - (lastMessage(state, a.id)?.at ?? 0));
		body = threads.map(thread => <ThreadCard key={thread.id} thread={thread} state={state} byId={byId} now={now} selected={open === thread.id} onOpen={onOpen} />);
	} else {
		const member = byId.get(view.id)!;
		const waiting = queueOf(state, members, member.id);
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
				{waiting.length === 0 ? <Empty>Nothing waiting.</Empty> : [...Map.groupBy(waiting, msg => msg.thread)].map(([threadId, msgs]) => <ThreadCard key={threadId} thread={state.threads.find(item => item.id === threadId)!} state={state} byId={byId} now={now} selected={open === threadId} onOpen={onOpen} preview={msgs.at(-1)} mention={msgs.some(msg => isMention(msg, member))} />)}
			</>
		);
	}
	return (
		<section aria-label={title} className="flex min-h-0 flex-col border-r border-border">
			<header className="flex h-(--page-header-height) shrink-0 items-center gap-3 border-b border-border px-4">
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-sm font-semibold">{title}</h2>
					<p className="truncate text-xs text-muted-foreground">{meta}</p>
				</div>
			</header>
			{view.kind === "channel" && (
				<label className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-sm text-muted-foreground">
					<IconMagnifyingGlass className="size-3.5" />
					<input value={q} onChange={event => setQ(event.target.value)} placeholder="Filter threads" className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
				</label>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
		</section>
	);
}

function presenceLine(member: Member) {
	return { working: "Working now", idle: "Idle, will pick up new messages", asking: "Waiting on an answer", asleep: "Asleep, messages queue", online: "Online", away: "Away" }[member.presence];
}

function Empty({ children }: { children: ReactNode }) {
	return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

function Chip({ children, tone }: { children: ReactNode; tone?: "blue" | "green" | "amber" | "red" | "violet" }) {
	const tones = { blue: "bg-sky-500/12 text-sky-700 dark:text-sky-300", green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300", red: "bg-red-500/12 text-red-700 dark:text-red-300", violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300" };
	return <span className={cn("inline-flex h-5 max-w-full items-center truncate rounded px-1.5 text-2xs font-medium", tone ? tones[tone] : "bg-foreground/[0.06] text-muted-foreground")}>{children}</span>;
}

const TASK_TONE = { open: "blue", claimed: "violet", review: "amber", done: "green", blocked: "red" } as const;

function TaskChip({ thread, byId, now }: { thread: Thread; byId: Map<string, Member>; now: number }) {
	if (!thread.task) return null;
	const holder = thread.lease ? byId.get(thread.lease.by) : undefined;
	const label = thread.task === "claimed" && holder ? `${holder.name} · ${relTime(thread.lease!.until, now).replace("in ", "")} left` : thread.task;
	return <Chip tone={TASK_TONE[thread.task]}>{label}</Chip>;
}

function ThreadCard({ thread, state, byId, now, selected, onOpen, preview, mention }: { thread: Thread; state: BoardState; byId: Map<string, Member>; now: number; selected: boolean; onOpen: (id: string) => void; preview?: Message; mention?: boolean }) {
	const last = preview ?? lastMessage(state, thread.id);
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
			<span className="mt-2 flex items-center gap-1.5">
				<TaskChip thread={thread} byId={byId} now={now} />
				{thread.labels.slice(0, 2).map(label => (
					<Chip key={label}>{label}</Chip>
				))}
				<span className="ml-auto flex -space-x-1.5">
					{people.map(member => (
						<span key={member.id} className="rounded-full ring-2 ring-background">
							<Avatar member={member} size="sm" />
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
}

function ThreadView({ state, thread, byId, members, now, typing, onPost, onCommand, onAnswer, onOpenThread }: ThreadViewProps) {
	const messages = state.messages.filter(msg => msg.thread === thread.id);
	const channel = state.channels.find(item => item.id === thread.channel)!;
	const scroller = useRef<HTMLDivElement>(null);
	const [showInternal, setShowInternal] = useState(true);
	useEffect(() => {
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
	}, [messages.length, typing]);
	const deps = thread.blockedBy.map(id => state.threads.find(item => item.id === id)!);
	const dependents = state.threads.filter(item => item.blockedBy.includes(thread.id));
	const shown = showInternal ? messages : messages.filter(msg => !msg.internal);
	const schedules = state.schedules.filter(item => item.thread === thread.id);

	return (
		<section aria-label={thread.title} className="flex min-h-0 min-w-0 flex-col">
			<header className="flex min-h-(--page-header-height) shrink-0 items-center gap-3 border-b border-border px-6">
				<div className="min-w-0 flex-1">
					<p className="flex items-center gap-1 text-2xs text-muted-foreground">
						<IconHashtag className="size-3" />
						{channel.name}
						{channel.sync && <span>· synced to {channel.sync}</span>}
					</p>
					<h2 className="truncate text-sm font-semibold">{thread.title}</h2>
				</div>
				<TaskChip thread={thread} byId={byId} now={now} />
				<label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
					<input type="checkbox" checked={showInternal} onChange={event => setShowInternal(event.target.checked)} className="accent-current" />
					Internal notes
				</label>
			</header>
			<div className="flex min-h-0 flex-1">
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
				<aside className="w-64 shrink-0 overflow-y-auto border-l border-border px-4 py-5 text-sm max-[1400px]:hidden">
					<SideHeading>Task</SideHeading>
					<div className="space-y-2">
						<Fact label="State">
							<span className="capitalize">{thread.task ?? "Discussion"}</span>
						</Fact>
						{thread.lease && <Fact label="Lease">{`${byId.get(thread.lease.by)?.name}, ${relTime(thread.lease.until, now).replace("in ", "")} left`}</Fact>}
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
										{relTime(item.at, now)} · {item.every ?? "once"} · {byId.get(item.to)?.name}
									</p>
									<p className="mt-1">{item.text}</p>
								</div>
							))}
						</>
					)}
				</aside>
			</div>
			<Composer members={members} onPost={onPost} onCommand={onCommand} channel={channel.name} />
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
					<Chip>{attachment.every ?? relTime(attachment.at, now)}</Chip>
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

type Suggestion = { kind: "member"; member: Member } | { kind: "command"; name: string; about: string };

function Composer({ members, onPost, onCommand, channel }: { members: Member[]; onPost: (text: string) => void; onCommand: (command: string, arg: string) => void; channel: string }) {
	const [text, setText] = useState("");
	const [active, setActive] = useState(0);
	const field = useRef<HTMLTextAreaElement>(null);
	const token = text.match(/(?:^|\s)([@/])([\p{L}'\- ]{0,20})$/u);
	const suggestions: Suggestion[] = !token
		? []
		: token[1] === "@"
			? members.filter(member => member.name.toLowerCase().startsWith(token[2]!.toLowerCase())).slice(0, 6).map(member => ({ kind: "member", member }))
			: text.trimStart().startsWith("/") && !text.includes(" ")
				? COMMANDS.filter(command => command.name.startsWith(token[2]!)).map(command => ({ kind: "command", ...command }))
				: [];

	function pick(suggestion: Suggestion) {
		const head = text.slice(0, text.length - token![2]!.length - 1);
		setText(`${head}${suggestion.kind === "member" ? `@${suggestion.member.name}` : `/${suggestion.name}`} `);
		setActive(0);
		field.current?.focus();
	}

	function send() {
		const trimmed = text.trim();
		if (!trimmed) return;
		const command = trimmed.match(/^\/([a-z]+)\s*(.*)$/s);
		if (command && COMMANDS.some(item => item.name === command[1])) onCommand(command[1]!, command[2]!);
		else onPost(trimmed);
		setText("");
	}

	return (
		<div className="shrink-0 px-6 pt-2 pb-5">
			<div className="relative mx-auto max-w-3xl">
				{suggestions.length > 0 && (
					<ul role="listbox" className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
						{suggestions.map((suggestion, i) => (
							<li key={suggestion.kind === "member" ? suggestion.member.id : suggestion.name} role="option" aria-selected={i === active}>
								<button type="button" onMouseDown={event => event.preventDefault()} onClick={() => pick(suggestion)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm", i === active && "bg-accent")}>
									{suggestion.kind === "member" ? (
										<>
											<Avatar member={suggestion.member} size="sm" />
											<span className="font-medium">{suggestion.member.name}</span>
											<span className="truncate text-xs text-muted-foreground">{suggestion.member.kind === "human" ? "person" : suggestion.member.harness}</span>
											{suggestion.member.presence === "asleep" && <span className="ml-auto text-2xs text-amber-700 dark:text-amber-300">queues until it wakes</span>}
										</>
									) : (
										<>
											<span className="w-20 font-mono text-[0.85em] font-medium text-violet-700 dark:text-violet-300">/{suggestion.name}</span>
											<span className="truncate text-xs text-muted-foreground">{suggestion.about}</span>
										</>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
				<div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_25%,transparent)]">
					<textarea
						ref={field}
						value={text}
						rows={2}
						onChange={event => {
							setText(event.target.value);
							setActive(0);
						}}
						onKeyDown={event => {
							if (suggestions.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
								event.preventDefault();
								setActive(i => (i + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
							} else if (suggestions.length > 0 && (event.key === "Tab" || event.key === "Enter")) {
								event.preventDefault();
								pick(suggestions[active]!);
							} else if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								send();
							}
						}}
						placeholder={`Reply in #${channel}. @ to ping a person or agent, / for a workflow`}
						className="block w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
					/>
					<div className="flex items-center gap-1 px-2 pb-2">
						{(["review", "implement", "schedule"] as const).map(name => (
							<button key={name} type="button" onClick={() => setText(`/${name} `)} className="h-7 rounded-md px-2 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
								/{name}
							</button>
						))}
						<button
							type="button"
							onClick={send}
							disabled={!text.trim()}
							aria-label="Send"
							className="ml-auto grid size-8 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
						>
							<IconArrowUp className="size-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
