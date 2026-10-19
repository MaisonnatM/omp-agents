/** `PullRequestDetailContent`: a pull request's details, its header over the Summary, Comments, Timeline, and Code tabs. */
import { FileDiff, FileText, History, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type LinkedPullRequest, type PullRequest, type PullRequestChange, type PullRequestDetail, type PullRequestSummary, type StackedPullRequest, samePullRequest } from "../../../../src/shared/github";
import type { RosterHost, View } from "../../../../src/shared/sessions";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { commentCount, moveAction, openThreads, pullRequestStatus, reason } from "../../../pull-requests-model";
import { type PullRequestActionId, pullRequestActions } from "../../../../src/pull-request-actions";
import { type AgentState, actionFacts, type MoveId, moveOf } from "../../../../src/shared/moves";
import { hashForPullRequests, hashForPullRequestFiles, type OpenMode } from "../../../routing";
import { useEditableRead } from "../../../editable-read";
import { useRead, writePullRequest } from "../../../reads";
import type { QuickActionsProps } from "../../quick-actions";
import { ERROR_TEXT } from "../../form-dialog";
import { usePullRequestOptions } from "../pr-fields";
import { LoadNote } from "../../sheet-details";
import { Timeline } from "../pr-timeline";
import { ChecksSummary } from "./checks";
import { Code } from "./code";
import { Comments } from "./comments";
import { DetailHeader } from "./header";
import { placeFixes } from "./status-view";
import { Summary } from "./summary";

/** What the pull request waits on next, from its action facts. */
export interface NextMove {
	move: MoveId;
	reason: string;
	/** The quick action that makes the move, when one applies. */
	action: PullRequestActionId | null;
	/** The running session that works on it or asks you, for the moves an agent holds. */
	session: RosterHost | null;
}

/** What `facts` wait on next, given where the sessions on it stand and the running `sessions` on it. */
function nextMove(facts: PullRequestSummary, agent: AgentState | null, sessions: RosterHost[]): NextMove {
	const move = moveOf(facts, agent);
	const holder = move === "answer" ? "needs-input" : move === "agent" ? "working" : null;
	return { move, reason: reason(facts, move), action: moveAction(facts, move), session: sessions.find(host => host.status === holder) ?? null };
}

export interface DetailContentProps {
	pr: PullRequest;
	/** Its pull request list entry, for who you are to it; `null` when the list does not hold it, so no move or quick action applies, since a start needs the workspace the list names. */
	listed: PullRequestSummary | null;
	/** Where the running sessions on it stand. */
	agent: AgentState | null;
	/** The quick action whose session is starting for it, if any. */
	pending: QuickActionsProps["pending"];
	/** Starts `action` on the pull request, as `facts` describe it. */
	onRun: (facts: PullRequestSummary, action: PullRequestActionId) => void;
	/** The running sessions that work on it. */
	sessions: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
	/** The session's pull requests, in the session details sidebar; those outside the stack list under it. */
	session?: LinkedPullRequest[];
	/** Where the details show: the main area's page, whose heading takes focus, or the session details sidebar, under its own heading. */
	placement: Placement;
	/** A change reads the pull request from GitHub again. */
	version?: unknown;
	/** The changed file the route opens in the Code tab; `null` shows the Summary. */
	files?: { path: string | null } | null;
	/** Shows another pull request of its stack or of the session in place; without it, each of its stack links to its page. */
	onPick?: (pr: PullRequest) => void;
	/** The workspace whose pull request list a change here shows in at once. */
	workspace: string | null;
	/** A checkout of its repository, where copying its branch removes the linked worktree that has it checked out; `null` when none is known. */
	cwd: string | null;
}

export type Placement = "page" | "sidebar";

type DetailTab = "summary" | "comments" | "timeline" | "code";

/**
 * The four labels and their counts outgrow the sidebar's default width, with or without the checks beside them, so
 * below 30rem the tabs show their icons alone, which the tooltip and screen readers still name.
 */
const TAB_CLASS = "@min-[30rem]/pr:[&>svg]:hidden @max-[30rem]/pr:px-1.5";
const LABEL_CLASS = "@max-[30rem]/pr:sr-only";

/**
 * A pull request read from GitHub: a header that names it, its branches and size, with the Next move's button and a menu
 * of the other actions; then Summary, Comments, Timeline, and Code tabs, with the checks at a glance on the tab bar.
 */
export function PullRequestDetailContent({ pr, listed, agent, pending, onRun, sessions, onOpen, session = [], placement, version, files = null, onPick, workspace, cwd }: DetailContentProps) {
	const query = new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) });
	// The list's state of it joins `version`, so a change made from its row, or one the list reads from GitHub, reads the details again.
	const { data: detail, error, saveError, edit, write } = useEditableRead<PullRequestDetail>(`/api/pull-request?${query}`, `${String(version)}:${listed?.state ?? "unlisted"}`);
	const stackRead = useRead<StackedPullRequest[]>(`/api/pull-request/stack?${query}`, version);
	const stack = stackRead.data ?? [];
	// Until the stack is read, its members would flash in the list of the others.
	const others = stackRead.data || stackRead.error ? session.filter(other => !samePullRequest(other, pr) && !stack.some(member => samePullRequest(member, other))) : [];
	const put = (change: PullRequestChange): Promise<PullRequestDetail> => writePullRequest(workspace, pr, change);
	const save = (change: PullRequestChange, shown: Partial<PullRequestDetail>): void => {
		if (detail) edit(shown, () => put(change));
	};
	const send = async (change: PullRequestChange): Promise<void> => {
		await write(() => put(change));
	};
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [tab, setTab] = useState<DetailTab>(files ? "code" : "summary");
	useEffect(() => {
		if (files) setTab("code");
	}, [files]);
	useEffect(() => {
		// The sidebar's details must leave the cursor in the pane's composer.
		if (placement === "page") headingRef.current?.focus({ preventScroll: true });
	}, [placement]);
	const choose = (value: DetailTab): void => {
		setTab(value);
		if (placement !== "page") return;
		if (value === "code" && !files) location.hash = hashForPullRequestFiles(pr);
		else if (value !== "code" && files) location.hash = hashForPullRequests(pr);
	};
	// The list's entry says who you are to it; the details, once read, say where it stands, as the Status shows.
	const facts = listed && actionFacts(listed, detail);
	const next = facts && nextMove(facts, agent, sessions);
	const quick: QuickActionsProps = { actions: facts ? pullRequestActions(facts) : [], pending, onRun: (action: PullRequestActionId) => facts && onRun(facts, action) };
	const offered = quick.actions.filter(action => action !== next?.action);
	const placed = detail ? placeFixes(pullRequestStatus(detail), offered) : [];
	const otherActions = detail || error ? offered.filter(action => !placed.some(({ fix }) => fix === action)) : [];
	const page = placement === "page";
	const options = usePullRequestOptions(pr);
	const comments = detail ? commentCount(detail) : 0;
	const timeline = detail ? detail.conversation.length + openThreads(detail).length : 0;
	return (
		<div className={cn("@container/pr flex min-h-0 flex-col", page && "h-full")}>
			<div className={cn(!page && "sticky top-0 z-10 -mx-4 bg-background px-4 pt-2")}>
				<DetailHeader pr={pr} detail={detail} readError={error} stack={stack} next={next} actions={otherActions} quick={quick} placed={placed} options={options} onOpen={onOpen} onSave={save} placement={placement} headingRef={headingRef} cwd={cwd} />
				<div className={cn("flex flex-wrap items-center gap-2 border-b border-border py-2", page && "px-6")}>
					<SizeProvider size="compact">
						<Tabs value={tab} onValueChange={value => choose(value as DetailTab)}>
							<TabsList aria-label="Show">
								<TabItem value="summary" label="Summary" icon={FileText} tooltip="Summary" className={TAB_CLASS} labelClassName={LABEL_CLASS} />
								<TabItem value="comments" label="Comments" icon={MessageSquare} tooltip="Comments" className={TAB_CLASS} labelClassName={LABEL_CLASS} badge={comments || undefined} aria-label={`Comments, ${comments} comments`} />
								<TabItem value="timeline" label="Timeline" icon={History} tooltip="Timeline" className={TAB_CLASS} labelClassName={LABEL_CLASS} badge={timeline || undefined} aria-label={`Timeline, ${timeline} comments`} />
								<TabItem value="code" label="Code" icon={FileDiff} tooltip="Code" className={TAB_CLASS} labelClassName={LABEL_CLASS} />
							</TabsList>
						</Tabs>
					</SizeProvider>
					<span className="ml-auto">{detail && <ChecksSummary checks={detail.checkRuns} />}</span>
				</div>
			</div>
			{!detail ? (
				<div className={cn("py-4", page && "px-6")}>
					<LoadNote loading="Asking GitHub for the pull request…" error={error && `Cannot load the pull request: ${error}`} />
				</div>
			) : tab === "code" ? (
				<div className={cn("flex min-h-0 flex-1 flex-col", !page && "pt-3")}>
					<Code pr={pr} detail={detail} placement={placement} path={files?.path ?? null} version={version} />
				</div>
			) : (
				<div className={cn(page && "min-h-0 flex-1 overflow-y-auto px-6")}>
					<div className="space-y-6 py-4">
						{saveError && (
							<p role="alert" className={ERROR_TEXT}>
								GitHub did not take the change: {saveError}
							</p>
						)}
						{tab === "summary" ? (
							<Summary pr={pr} detail={detail} options={options} stack={stack} others={others} sessions={sessions} onOpen={onOpen} onPick={onPick} save={save} />
						) : tab === "comments" ? (
							<Comments detail={detail} save={save} send={send} />
						) : (
							<Timeline detail={detail} />
						)}
					</div>
				</div>
			)}
		</div>
	);
}
