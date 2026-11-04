/**
 * The New session page's hero and board above the composer: open todos, sessions to resume, and pull requests waiting on your move,
 * each one click from an agent; a personal draft's board of what it remembers; and a private draft's hero of what it deletes.
 */
import { Brain, CircleDashed, FileCode, GitPullRequest, History, Lock, type LucideIcon, Trash2, UserRound } from "lucide-react";
import { useContext, useMemo, type ReactNode } from "react";
import { prKey } from "../../src/shared/github";
import { agentOn } from "../../src/shared/moves";
import type { PastSession, RosterHost } from "../../src/shared/sessions";
import { cn } from "@/lib/utils";
import { localDay } from "../../src/shared/days";
import { memoryEntries } from "../bots-model";
import { pastLabel } from "../labels";
import { boardPullRequests, boardSessions, boardTodos, BOARD_ROWS } from "../new-session-board-model";
import { readPinnedSkill } from "../pinned-skill";
import { pendingOf, pullRequestStart, QUICK_ACTIONS } from "../quick-actions";
import { pullRequestsStore } from "../reads";
import { hashForNewSession, hashForPullRequests, hashForTodo } from "../routing";
import { TODO_STATUS, todoCwd } from "../todo-views";
import { Age } from "./age";
import { useDashboardActions, useDashboardStatus, UserTodosContext } from "./dashboard-context";
import { STATE_ICON } from "./pull-requests/avatars";
import { MoveBadge } from "./pull-requests/pr-row";
import { DueText, StatusIcon } from "./todo/fields";

interface Props {
	/** The composer's directory, which a todo with no Workspace starts its session in. */
	cwd: string;
	hosts: RosterHost[];
	past: PastSession[];
	/** The sidebar's workspace, `null` for all, which scopes the sessions. */
	workspace: string | null;
	/** The line under the heading: what sending the first message does. */
	note: string;
}

export function NewSessionBoard({ cwd, hosts, past, workspace, note }: Props) {
	const { start } = useDashboardActions();
	const { pullRequestsScope, starts } = useDashboardStatus();
	const list = useContext(UserTodosContext);
	const pullRequestList = pullRequestsStore.use(pullRequestsScope).read?.data ?? null;
	const todos = useMemo(() => boardTodos(list?.todos ?? []), [list]);
	const sessions = useMemo(() => boardSessions(past, workspace), [past, workspace]);
	const pullRequests = useMemo(() => boardPullRequests(pullRequestList, agentOn(hosts)), [pullRequestList, hosts]);
	const resuming = starts.resume?.phase === "starting" ? starts.resume.op.sessionId : null;
	const day = localDay();
	return (
		<BoardShell title="Start a session" note={note}>
				<section aria-label="Pick up work" className="mx-auto grid w-full max-w-[1040px] grid-cols-1 rounded-[18px] bg-card/80 shadow-surface-3 backdrop-blur md:grid-cols-3 [&>*+*]:border-t [&>*+*]:border-border md:[&>*+*]:border-t-0 md:[&>*+*]:border-s">
					<Column icon={CircleDashed} title="Todos for agents" count={todos.length} all={hashForTodo({ kind: "all" })} empty="No open todos.">
						{todos.slice(0, BOARD_ROWS).map(todo => (
							<Row key={todo.id} title={todo.text} action="Start" onPick={() => (location.hash = hashForNewSession(todoCwd(todo, cwd), todo.id))} icon={<StatusIcon status={todo.status} className="size-3.5" />}>
								{todo.due ? <DueText due={todo.due} day={day} /> : TODO_STATUS[todo.status].label}
							</Row>
						))}
					</Column>
					<Column icon={History} title="Pick up where you left off" count={sessions.length} empty="No sessions to resume.">
						{sessions.slice(0, BOARD_ROWS).map(session => (
							<ResumeRow key={session.sessionId} session={session} resuming={resuming} />
						))}
					</Column>
					<Column icon={GitPullRequest} title="Pull requests waiting" count={pullRequests.length} all={hashForPullRequests(null)} empty="Nothing waits on you.">
						{pullRequests.slice(0, BOARD_ROWS).map(({ pr, move, action, cwd: repoCwd }) => {
							const [Icon, color] = STATE_ICON[pr.state];
							const pending = pendingOf(starts.quick, { kind: "pull-request", pr });
							return (
								<Row
									key={prKey(pr)}
									title={pr.title}
									action={QUICK_ACTIONS[action].label}
									busy={pending === action}
									disabled={pending !== null}
									onPick={() => start(pullRequestStart(pr, action, repoCwd, readPinnedSkill()))}
									icon={<Icon aria-hidden className={cn("size-3.5", color)} />}
								>
									<span className="inline-flex items-center gap-1.5">
										<span className="tabular-nums">#{pr.number}</span>
										<MoveBadge move={move} />
									</span>
								</Row>
							);
						})}
					</Column>
				</section>
		</BoardShell>
	);
}

interface PersonalBoardProps {
	/** The personal directory. */
	cwd: string;
	past: PastSession[];
	/** `personal-memory.md`'s text. */
	memory: string;
}

/** A personal draft's board: the facts every personal session shares, newest first, and the personal sessions to resume. */
export function PersonalBoard({ cwd, past, memory }: PersonalBoardProps) {
	const { starts } = useDashboardStatus();
	const facts = useMemo(() => memoryEntries(memory).toReversed(), [memory]);
	const sessions = useMemo(() => boardSessions(past, cwd), [past, cwd]);
	const resuming = starts.resume?.phase === "starting" ? starts.resume.op.sessionId : null;
	return (
		<BoardShell title="Your assistant" note="For meals, shopping, plans, and everything outside code. It remembers what you tell it about yourself." icon={<HeroIcon icon={UserRound} className="bg-violet-500/12 text-violet-700 dark:text-violet-300" />}>
			<section aria-label="Your assistant" className="mx-auto grid w-full max-w-[760px] grid-cols-1 rounded-[18px] bg-card/80 shadow-surface-3 backdrop-blur md:grid-cols-[1.3fr_1fr] [&>*+*]:border-t [&>*+*]:border-border md:[&>*+*]:border-t-0 md:[&>*+*]:border-s">
				<Column icon={Brain} title="What it remembers" count={facts.length} empty="Nothing yet. Tell it something worth keeping, and it remembers it.">
					{facts.slice(0, BOARD_ROWS).map((entry, index) => (
						<li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-2.5 py-[9px]">
							<span className="truncate text-[13.5px]">{entry.fact}</span>
							{entry.date && <span className="text-[11.5px] tabular-nums text-muted-foreground">{entry.date}</span>}
						</li>
					))}
				</Column>
				<Column icon={History} title="Recent" count={sessions.length} empty="No personal sessions yet.">
					{sessions.slice(0, BOARD_ROWS).map(session => (
						<ResumeRow key={session.sessionId} session={session} resuming={resuming} />
					))}
				</Column>
			</section>
		</BoardShell>
	);
}

/** A private draft's hero: what ending it deletes, and what stays. */
export function PrivateHero({ personal }: { personal: boolean }) {
	const facts: { icon: LucideIcon; title: string; text: string }[] = [
		{ icon: History, title: "Not in Past sessions", text: "It never shows there, and you cannot resume it." },
		{ icon: Trash2, title: "Deleted when it ends", text: "Its conversation, its subagents, and its prompts in history go with it." },
		personal
			? { icon: Brain, title: "Memory stays on", text: "It still reads what it knows about you and can add to it." }
			: { icon: FileCode, title: "Your files stay", text: "Files it changes and commits it makes stay in the project." },
	];
	return (
		<BoardShell title={personal ? "Private, personal" : "Private session"} icon={<HeroIcon icon={Lock} className="bg-foreground text-background" />}>
			<ul aria-label="What a private session keeps" className="mx-auto grid w-full max-w-[680px] grid-cols-1 gap-3 sm:grid-cols-3">
				{facts.map(({ icon: Icon, title, text }) => (
					<li key={title} className="rounded-xl bg-card/80 p-3 shadow-surface-2">
						<p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
							<Icon aria-hidden className="size-3.5 text-muted-foreground" />
							{title}
						</p>
						<p className="text-xs text-pretty text-muted-foreground">{text}</p>
					</li>
				))}
			</ul>
		</BoardShell>
	);
}

function BoardShell({ title, note, icon, children }: { title: string; note?: string; icon?: ReactNode; children: ReactNode }) {
	return (
		<div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-3">
			<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-80 max-w-3xl rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_9%,transparent),transparent)] blur-[24px]" />
			<div className="relative m-auto flex w-full flex-col items-center gap-7 py-8">
				<div className="flex flex-col items-center gap-1.5 text-center">
					{icon}
					<h2 className="text-[30px] leading-tight font-semibold tracking-[-0.022em] text-balance">{title}</h2>
					{note && <p className="text-sm text-pretty text-muted-foreground">{note}</p>}
				</div>
				{children}
			</div>
		</div>
	);
}

function HeroIcon({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
	return (
		<span aria-hidden className={cn("mb-2.5 flex size-10 items-center justify-center rounded-full", className)}>
			<Icon className="size-[18px]" />
		</span>
	);
}

function ResumeRow({ session, resuming }: { session: PastSession; resuming: string | null }) {
	const { start } = useDashboardActions();
	return (
		<Row
			title={pastLabel(session)}
			action={resuming === session.sessionId ? "Resuming…" : "Resume"}
			busy={resuming === session.sessionId}
			disabled={resuming !== null}
			onPick={() => start({ kind: "resume", sessionId: session.sessionId })}
			icon={<span aria-hidden className={cn("size-2 rounded-full", session.interrupted ? "bg-amber-500" : "bg-muted-foreground/40")} />}
		>
			{session.interrupted ? "Interrupted" : "Ended"} · <Age at={session.modifiedAt} compact className="tabular-nums" />
		</Row>
	);
}

function Column({ icon: Icon, title, count, all, empty, children }: { icon: LucideIcon; title: string; count: number; all?: string; empty: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1 p-2.5">
			<header className="flex items-center gap-2 px-2.5 pt-1 pb-1.5 text-[13px]">
				<Icon aria-hidden className="size-3.5 text-muted-foreground" />
				<h3 className="font-semibold">{title}</h3>
				<span className="tabular-nums text-muted-foreground">{count}</span>
				{all && (
					<a href={all} className="ml-auto rounded px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
						All
					</a>
				)}
			</header>
			{count > 0 ? <ul className="flex flex-col">{children}</ul> : <p className="px-2.5 py-2 text-[13px] text-muted-foreground">{empty}</p>}
		</div>
	);
}

function Row({ title, action, icon, busy, disabled, onPick, children }: { title: string; action: string; icon: ReactNode; busy?: boolean; disabled?: boolean; onPick: () => void; children: ReactNode }) {
	return (
		<li>
			<button
				type="button"
				disabled={disabled}
				aria-busy={busy || undefined}
				onClick={onPick}
				className="group/row grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[10px] px-2.5 py-[9px] text-left outline-none transition-[background-color,scale] duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] active:bg-active disabled:opacity-60 motion-reduce:transition-none"
			>
				<span className="row-span-2 flex justify-center">{icon}</span>
				<span className="truncate text-[13.5px] font-medium">{title}</span>
				<span className={cn("row-span-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100 [@media(hover:none)]:opacity-100", busy && "opacity-100 motion-safe:animate-pulse")}>{action} →</span>
				<span className="truncate text-[11.5px] text-muted-foreground">{children}</span>
			</button>
		</li>
	);
}
