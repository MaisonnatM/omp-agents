/** `PullRequestDetailContent`: a pull request's details, its header over the Summary, Comments, Timeline, Code, and Review draft tabs. */
import { ClipboardPen, FileDiff, FileText, History, MessageSquare } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { type LinkedPullRequest, type PullRequest, type PullRequestChange, type PullRequestDetail, type PullRequestSummary, type StackedPullRequest, prKey, samePullRequest } from "../../../../src/shared/github";
import { reviewDraftOf } from "../../../../src/shared/review-drafts";
import type { RosterHost, View } from "../../../../src/shared/sessions";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "../../segmented-tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PullRequestDetailTab } from "../../../pull-request-tabs";
import { commentCount } from "../../../pull-requests-model";
import { type PullRequestActionId, pullRequestActions } from "../../../../src/pull-request-actions";
import { actionFacts } from "../../../../src/shared/moves";
import type { OpenMode } from "../../../routing";
import { useEditableRead } from "../../../editable-read";
import { useRead, writePullRequest } from "../../../reads";
import type { QuickActionsProps } from "../../quick-actions";
import { useDashboardStatus } from "../../dashboard-context";
import { DetailsScrollerContext } from "../../details-sidebar-frame";
import { ERROR_TEXT } from "../../form-dialog";
import { usePullRequestOptions } from "../pr-fields";
import { LoadNote } from "../../sheet-details";
import { Timeline } from "../pr-timeline";
import { ChecksSummary } from "./checks";
import { Code } from "./code";
import { Comments } from "./comments";
import { DetailHeader } from "./header";
import { ReviewDraftPanel } from "./review-draft";
import { Summary } from "./summary";
import { useCondensedHeader } from "./use-condensed-header";

export interface DetailContentProps {
	pr: PullRequest;
	/** Its pull request list entry, for who you are to it; `null` when the list does not hold it, so no move or quick action applies, since a start needs the workspace the list names. */
	listed: PullRequestSummary | null;
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
	/** The tab it shows; its host keeps it, and on the page the route decides whether it is Code. */
	tab: PullRequestDetailTab;
	onTab: (tab: PullRequestDetailTab) => void;
	/** The changed file the route opens in the Code tab. */
	path?: string | null;
	/** Shows another pull request of its stack or of the session in place; without it, each of its stack links to its page. */
	onPick?: (pr: PullRequest) => void;
	/** The workspace whose pull request list a change here shows in at once. */
	workspace: string | null;
	/** A checkout of its repository, where copying its branch removes the linked worktree that has it checked out; `null` when none is known. */
	cwd: string | null;
}

export type Placement = "page" | "sidebar";

/**
 * The labels and their counts outgrow the sidebar's default width, with or without the checks beside them, so
 * below 30rem the tabs show their icons alone, which the tooltip and screen readers still name.
 */
const TAB_CLASS = "@min-[30rem]/pr:[&>svg]:hidden @max-[30rem]/pr:px-1.5";
const LABEL_CLASS = "@max-[30rem]/pr:sr-only";

/**
 * A pull request read from GitHub: a header that names it, its branches and size, with the Next move's button and a menu
 * of the other actions; then Summary, Comments, Timeline, and Code tabs, and a Review draft tab while a Review session's
 * draft of it is kept, with the checks at a glance on the tab bar.
 */
export function PullRequestDetailContent({ pr, listed, pending, onRun, sessions, onOpen, session = [], placement, version, tab: picked, onTab, path = null, onPick, workspace, cwd }: DetailContentProps) {
	const query = new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) });
	// The list's state of it joins `version`, so a change made from its row, or one the list reads from GitHub, reads the details again.
	const { data: detail, error, saveError, edit, write, reload } = useEditableRead<PullRequestDetail>(`/api/pull-request?${query}`, `${String(version)}:${listed?.state ?? "unlisted"}`);
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
	const draft = reviewDraftOf(useDashboardStatus().reviewDrafts, pr);
	// A discarded draft takes its tab with it.
	const tab = picked === "review" && !draft ? "summary" : picked;
	useEffect(() => {
		// The sidebar's details must leave the cursor in the pane's composer.
		if (placement === "page") headingRef.current?.focus({ preventScroll: true });
	}, [placement]);
	const facts = listed && actionFacts(listed, detail);
	const quick: QuickActionsProps = { actions: facts ? pullRequestActions(facts) : [], pending, onRun: (action: PullRequestActionId) => facts && onRun(facts, action) };
	const page = placement === "page";
	const options = usePullRequestOptions(pr);
	const comments = detail ? commentCount(detail) : 0;
	const pendingFindings = draft && !draft.posted ? draft.findings.filter(finding => finding.state === "pending").length : 0;
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const foldRef = useRef<HTMLDivElement>(null);
	const sidebarScroller = useContext(DetailsScrollerContext);
	const condensed = useCondensedHeader(page ? root : sidebarScroller, root, foldRef, tab);
	return (
		<SegmentedTabs ref={setRoot} value={tab} onValueChange={value => onTab(value as PullRequestDetailTab)} className={cn("@container/pr flex min-h-0 flex-col", page && "h-full overflow-y-auto")}>
			<div className={cn("sticky top-0 z-10 shrink-0 bg-background", !page && "-mx-4 pt-2")}>
				<DetailHeader pr={pr} detail={detail} stack={stack} quick={quick} onSave={save} send={send} onMergeQueued={reload} placement={placement} headingRef={headingRef} cwd={cwd} condensed={condensed} foldRef={foldRef} />
				<nav aria-label="Pull request tabs" className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2">
					<SegmentedTabsList aria-label="Pull request details">
						{([
							{ value: "summary", label: "Summary", Icon: FileText, name: "Summary" },
							{ value: "comments", label: "Comments", Icon: MessageSquare, name: `Comments, ${comments} comments` },
							{ value: "timeline", label: "Timeline", Icon: History, name: `Timeline, ${comments} comments` },
							{ value: "code", label: "Code", Icon: FileDiff, name: "Code" },
							...(draft ? [{ value: "review", label: "Review draft", Icon: ClipboardPen, name: `Review draft, ${pendingFindings} pending findings${draft.posted ? ", posted" : ""}` }] : []),
						]).map(({ value, label, Icon, name }) => (
							<Tooltip key={value} content={name} side="bottom">
								<SegmentedTab value={value} className={TAB_CLASS} aria-label={name}>
									<Icon aria-hidden className="size-3.5" />
									<span className={LABEL_CLASS}>{label}</span>
								</SegmentedTab>
							</Tooltip>
						))}
					</SegmentedTabsList>
					{detail && <ChecksSummary checks={detail.checkRuns} />}
				</nav>
			</div>
			<SegmentedTabPanel value={tab} asChild>
				{!detail ? (
					<div className={cn("py-4", page && "px-6")}>
						<LoadNote loading="Asking GitHub for the pull request…" error={error && `Cannot load the pull request: ${error}`} />
					</div>
				) : tab === "code" ? (
					<div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !page && "-mx-4 h-[65vh] flex-none pt-3")}>
						<Code key={prKey(pr)} pr={pr} detail={detail} placement={placement} path={path} version={version} />
					</div>
				) : (
					<div className={cn("shrink-0", page && "px-6")}>
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
							) : tab === "timeline" ? (
								<Timeline detail={detail} placement={placement} />
							) : (
								draft && <ReviewDraftPanel draft={draft} headOid={detail.headOid} />
							)}
						</div>
					</div>
				)}
			</SegmentedTabPanel>
		</SegmentedTabs>
	);
}
