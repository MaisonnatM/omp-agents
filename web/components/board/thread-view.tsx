/** An open Board thread: its messages, the composer, and a details column with its task, people, and schedules. */
import { IconCheckmark1, IconChevronDownSmall, IconChevronLeft, IconChevronTopSmall, IconClock, IconCrossMedium, IconHashtag, IconSidebarSimpleRightWide } from "central-icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { boardTokens } from "../../board-composer";
import { boardMessagePreset, type MarkdownPreset, MessageMarkdown } from "../message-markdown";
import { BOARD_COMMANDS, type BoardCommand, type BoardIndex, type BoardState, type Member, type Message, repeatLabel, type Thread } from "../../../src/shared/board";
import { splitSuggestions } from "../../../src/shared/transcript";
import { AttachmentCard } from "./attachments";
import { Composer } from "./composer";
import { Avatar, Chip, feedLead, leaseLabel, relTime, TaskChip } from "./parts";
import type { Workspace } from "../../../src/shared/workspaces";
import { DirectoryPicker } from "../workspace-picker";

/** Where the workspace a Board thread last started a session in is kept, so the next thread offers it first. */
const LAST_WORKSPACE_KEY = "board.lastWorkspace";

const DONE = BOARD_COMMANDS.find(command => command.name === "done")!;

interface ThreadViewProps {
	state: BoardState;
	index: BoardIndex;
	thread: Thread;
	members: Member[];
	now: number;
	typing?: Member;
	/** The workspaces the composer's picker offers while the thread's next message starts a session. */
	workspaces: Workspace[];
	/** Posts `text`; `cwd` is where the session it starts runs, when it starts one. */
	onPost: (text: string, cwd?: string) => void;
	onCommand: (command: BoardCommand, arg: string) => void;
	/** Closes the thread; the narrow page, which hides the list while a thread is open, shows this as Back to list. */
	onClose: () => void;
	/** Opens the thread above or below this one in the list, absent at either end. */
	onPrevious?: () => void;
	onNext?: () => void;
}

export function ThreadView({ state, index, thread, members, now, typing, workspaces, onPost, onCommand, onClose, onPrevious, onNext }: ThreadViewProps) {
	const byId = index.memberById;
	const messages = index.messagesByThread.get(thread.id) ?? [];
	// Keyed on the names, not the roster's identity, which every presence change renews: a new tokenizer renders every message again.
	const names = members.map(member => `${member.id}\0${member.name}`).join("\n");
	const tokenize = useMemo(() => boardTokens(members), [names]);
	const preset = useMemo(() => boardMessagePreset(tokenize), [tokenize]);
	const channel = index.channelById.get(thread.channel)?.name ?? thread.channel;
	// A message here starts a session while no agent posted yet; inside a project, the project picks the workspace.
	const startsSession = !index.channelById.get(thread.channel)?.project && messages.every(msg => byId.get(msg.author)?.kind === "human");
	const [cwd, setCwd] = useState(() => localStorage.getItem(LAST_WORKSPACE_KEY) ?? workspaces[0]?.cwd ?? "~");
	const post = (text: string) => {
		if (!startsSession) return onPost(text);
		localStorage.setItem(LAST_WORKSPACE_KEY, cwd);
		onPost(text, cwd);
	};
	const picker = startsSession ? <DirectoryPicker cwd={cwd} workspaces={workspaces} disabled={false} tooltip={`Starts a session in ${cwd}`} onPick={setCwd} /> : undefined;
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
	const shown = showInternal ? messages : messages.filter(msg => !msg.internal);
	const schedules = state.schedules.filter(item => item.thread === thread.id);
	// The prompts the thread's last message suggests, offered as replies while an agent wrote it.
	const last = messages.at(-1);
	const prompts = last && byId.get(last.author)?.kind !== "human" ? splitSuggestions(last.text).suggestions : [];

	return (
		<section aria-label={thread.title} className="flex min-h-0 min-w-0 flex-col">
			<header className="flex h-(--page-header-height) shrink-0 items-center gap-3 border-b border-border px-6">
				<Button variant="ghost" size="icon-compact" aria-label="Back to list" className="-ml-2 shrink-0 @min-[46rem]:hidden max-phone:inline-flex" onClick={onClose}>
					<IconChevronLeft />
				</Button>
				<div className="min-w-0 flex-1">
					<h2 title={thread.title} className="truncate text-sm font-semibold">{thread.title}</h2>
					<p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
						<IconHashtag className="size-3" />
						{channel}
					</p>
				</div>
				<TaskChip thread={thread} byId={byId} now={now} />
				{thread.task !== "done" && (
					<Button variant="outline" size="compact" className="shrink-0" onClick={() => onCommand(DONE, "")}>
						<IconCheckmark1 />
						Mark done
					</Button>
				)}
				<label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
					<input type="checkbox" checked={showInternal} onChange={event => setShowInternal(event.target.checked)} className="accent-current" />
					Internal notes
				</label>
				<div className="flex shrink-0 items-center">
					<Button variant="ghost" size="icon-compact" aria-label="Previous thread" title="Previous thread (K)" disabled={!onPrevious} onClick={onPrevious}>
						<IconChevronTopSmall />
					</Button>
					<Button variant="ghost" size="icon-compact" aria-label="Next thread" title="Next thread (J)" disabled={!onNext} onClick={onNext}>
						<IconChevronDownSmall />
					</Button>
					<Button variant="ghost" size="icon-compact" aria-label="Details" aria-expanded={details} className="min-[1400px]:hidden" onClick={() => setDetails(open => !open)}>
						<IconSidebarSimpleRightWide />
					</Button>
					<Button variant="ghost" size="icon-compact" aria-label="Close thread" title="Close thread (Esc)" className="-mr-2 max-phone:hidden @max-[46rem]:hidden" onClick={onClose}>
						<IconCrossMedium />
					</Button>
				</div>
			</header>
			<div className="relative flex min-h-0 flex-1">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
					<ol className="mx-auto max-w-3xl px-6 py-6">
						{shown.map((msg, i) => {
							const prev = shown[i - 1];
							const grouped = prev && prev.author === msg.author && msg.at - prev.at < 10 * 60_000;
							return <MessageRow key={msg.id} msg={msg} author={byId.get(msg.author)} grouped={!!grouped} now={now} preset={preset} />;
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
				<Composer members={members} tokenize={tokenize} picker={picker} prompts={prompts} onPost={post} onCommand={onCommand} channel={channel} />
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
					</div>
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
										{relTime(item.at, now)} · {item.every ? repeatLabel(item.every) : "once"} · {byId.get(item.to)?.name ?? item.toName}
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

function MessageRow({ msg, author, grouped, now, preset }: { msg: Message; author?: Member; grouped: boolean; now: number; preset: MarkdownPreset }) {
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
					</p>
				)}
				{msg.text && <MessageBody text={msg.text} preset={preset} />}
				{msg.attachment && <AttachmentCard attachment={msg.attachment} now={now} />}
			</div>
		</li>
	);
}

/** A message's text without the prompts it suggests, which the composer offers, and with a session feed post's lead shown as a status chip instead of a repeated mention. */
function MessageBody({ text: full, preset }: { text: string; preset: MarkdownPreset }) {
	const text = splitSuggestions(full).body;
	const lead = feedLead(text);
	return (
		<div className="text-sm leading-relaxed">
			{lead && (
				<span className="mt-0.5 mb-1 block">
					<Chip tone={lead.tone}>{lead.label}</Chip>
				</span>
			)}
			<MessageMarkdown text={lead?.body ?? text} preset={preset} />
		</div>
	);
}
