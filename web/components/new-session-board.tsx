/** The New session page's board above the composer: open todos, sessions to resume, and pull requests waiting on your move, each one click from an agent. */
import { CircleDashed, GitPullRequest, GitPullRequestDraft, History, type LucideIcon } from "lucide-react";
import { useContext, useMemo, type ReactNode } from "react";
import { agentOn } from "../../src/shared/moves";
import type { PastSession, RosterHost } from "../../src/shared/sessions";
import { cn } from "@/lib/utils";
import { pastLabel } from "../labels";
import { boardPullRequests, boardSessions, boardTodos, BOARD_ROWS } from "../new-session-board-model";
import { readPinnedSkill } from "../pinned-skill";
import { MOVES } from "../pull-requests-model";
import { pendingOf, pullRequestStart, QUICK_ACTIONS } from "../quick-actions";
import { pullRequestsStore } from "../reads";
import { hashForNewSession, hashForPullRequests, hashForTodo } from "../routing";
import { Age } from "./age";
import { useDashboardActions, useDashboardStatus, UserTodosContext } from "./dashboard-context";

interface Props {
	/** The composer's directory, which a todo's session starts in. */
	cwd: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The sidebar's workspace, `null` for all, which scopes the sessions. */
	workspace: string | null;
}

export function NewSessionBoard({ cwd, hosts, past, workspace }: Props) {
	const { start } = useDashboardActions();
	const { pullRequestsScope, starts } = useDashboardStatus();
	const list = useContext(UserTodosContext);
	const pullRequestList = pullRequestsStore.use(pullRequestsScope).read?.data ?? null;
	const todos = useMemo(() => boardTodos(list?.todos ?? []), [list]);
	const sessions = useMemo(() => boardSessions(past, workspace), [past, workspace]);
	const pullRequests = useMemo(() => boardPullRequests(pullRequestList, agentOn(hosts)), [pullRequestList, hosts]);
	return (
		<section aria-label="Pick up work" className="mx-auto grid w-full max-w-[1040px] grid-cols-1 rounded-[18px] bg-card/80 shadow-surface-3 backdrop-blur md:grid-cols-3 [&>*+*]:border-t [&>*+*]:border-border md:[&>*+*]:border-t-0 md:[&>*+*]:border-s">
			<Column icon={CircleDashed} title="Todos for agents" count={todos.length} all={hashForTodo({ kind: "all" })} empty="No open todos.">
				{todos.slice(0, BOARD_ROWS).map(todo => (
					<Row key={todo.id} title={todo.text} action="Start" onPick={() => (location.hash = hashForNewSession(cwd, todo.id))} icon={<CircleDashed aria-hidden className="size-3.5 text-muted-foreground" />}>
						{todo.status === "in-progress" ? "In progress" : todo.due ? `Due ${todo.due}` : todo.status === "backlog" ? "Backlog" : "Todo"}
					</Row>
				))}
			</Column>
			<Column icon={History} title="Pick up where you left off" count={sessions.length} empty="No sessions to resume.">
				{sessions.slice(0, BOARD_ROWS).map(session => (
					<Row
						key={session.sessionId}
						title={pastLabel(session)}
						action="Resume"
						disabled={starts.resume !== null}
						onPick={() => start({ kind: "resume", sessionId: session.sessionId })}
						icon={<span aria-hidden className={cn("size-2 rounded-full", session.interrupted ? "bg-amber-500" : "bg-muted-foreground/40")} />}
					>
						{session.interrupted ? "Interrupted" : "Ended"} · <Age at={session.modifiedAt} compact className="tabular-nums" />
					</Row>
				))}
			</Column>
			<Column icon={GitPullRequest} title="Pull requests waiting" count={pullRequests.length} all={hashForPullRequests(null)} empty="Nothing waits on you.">
				{pullRequests.slice(0, BOARD_ROWS).map(({ pr, move, action, cwd: repoCwd }) => {
					const Icon = pr.state === "draft" ? GitPullRequestDraft : GitPullRequest;
					return (
						<Row
							key={`${pr.owner}/${pr.repo}#${pr.number}`}
							title={pr.title}
							action={QUICK_ACTIONS[action].label}
							disabled={pendingOf(starts.quick, { kind: "pull-request", pr }) !== null}
							onPick={() => start(pullRequestStart(pr, action, repoCwd, readPinnedSkill()))}
							icon={<Icon aria-hidden className={cn("size-3.5", pr.state === "draft" ? "text-muted-foreground" : "text-green-600 dark:text-green-500")} />}
						>
							<span className="tabular-nums">#{pr.number}</span> · <span className={move === "fix-ci" || move === "rebase" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}>{MOVES[move].label}</span>
						</Row>
					);
				})}
			</Column>
		</section>
	);
}

function Column({ icon: Icon, title, count, all, empty, children }: { icon: LucideIcon; title: string; count: number; all?: string; empty: string; children: ReactNode[] }) {
	return (
		<div className="flex min-w-0 flex-col gap-1 p-2.5">
			<header className="flex items-center gap-2 px-2.5 pt-1 pb-1.5 text-[13px]">
				<Icon aria-hidden className="size-3.5 text-muted-foreground" />
				<h2 className="font-semibold">{title}</h2>
				<span className="tabular-nums text-muted-foreground">{count}</span>
				{all && (
					<a href={all} className="ml-auto rounded px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
						All
					</a>
				)}
			</header>
			{children.length > 0 ? <ul className="flex flex-col">{children}</ul> : <p className="px-2.5 py-2 text-[13px] text-muted-foreground">{empty}</p>}
		</div>
	);
}

function Row({ title, action, icon, disabled, onPick, children }: { title: string; action: string; icon: ReactNode; disabled?: boolean; onPick: () => void; children: ReactNode }) {
	return (
		<li>
			<button
				type="button"
				disabled={disabled}
				onClick={onPick}
				className="group/row grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[10px] px-2.5 py-[9px] text-left outline-none transition-[background-color,scale] duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] active:bg-active disabled:opacity-60 motion-reduce:transition-none"
			>
				<span className="row-span-2 flex justify-center">{icon}</span>
				<span className="truncate text-[13.5px] font-medium">{title}</span>
				<span className="row-span-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100 [@media(hover:none)]:opacity-100">{action} →</span>
				<span className="truncate text-[11.5px] text-muted-foreground">{children}</span>
			</button>
		</li>
	);
}
