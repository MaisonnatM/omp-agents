import { useEffect, useMemo, useRef, useState } from "react";
import { type LinkedPullRequest, type PullRequest, type PullRequestChange, type PullRequestDetail, type StackedPullRequest, samePullRequest } from "../../../../src/shared/github";
import type { RosterHost, View } from "../../../../src/shared/sessions";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { pullRequestStatus } from "../../../inbox-model";
import { putJson } from "../../../api";
import type { PullRequestActionId } from "../../../../src/pull-request-actions";
import type { MoveId } from "../../../../src/shared/moves";
import { hashForInbox, hashForPullRequestFiles, type OpenMode } from "../../../routing";
import { useRead, useReplaceableRead } from "../../../reads";
import { useQueuedSave } from "../../../use-queued-save";
import type { QuickActionsProps } from "../../quick-actions";
import { LoadNote } from "../../sheet-details";
import { Timeline } from "../pr-timeline";
import { ChecksSummary } from "./checks";
import { Code } from "./code";
import { DetailHeader } from "./header";
import { placeFixes } from "./status-view";
import { Summary } from "./summary";

/** What the pull request waits on next, as the inbox lists it. */
export interface NextMove {
	move: MoveId;
	reason: string;
	/** The quick action that makes the move, when one applies. */
	action: PullRequestActionId | null;
	/** The running session that works on it or asks you, for the moves an agent holds. */
	session: RosterHost | null;
}

export interface DetailContentProps {
	pr: PullRequest;
	/** The quick actions on it; none apply when the inbox does not list it, since a start needs the workspace the inbox names. */
	quick: QuickActionsProps;
	/** The running sessions that work on it. */
	sessions: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
	/** Its move; `null` when the inbox does not list it. */
	next: NextMove | null;
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
	/** GitHub took a change made here. */
	onSaved?: () => void;
}

export type Placement = "page" | "sidebar";

type DetailTab = "summary" | "timeline" | "code";

/**
 * A pull request read from GitHub: a header that names it, its branches and size, with the Next move's button and a menu
 * of the other actions; then Summary, Timeline, and Code tabs, with the checks at a glance on the tab bar.
 */
export function PullRequestDetailContent({ pr, quick, sessions, onOpen, next: listedNext, session = [], placement, version, files = null, onPick, onSaved }: DetailContentProps) {
	const [reads, setReads] = useState(0);
	const readVersion = useMemo(() => [version, reads], [version, reads]);
	const query = new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) });
	const { data: detail, error, replace } = useReplaceableRead<PullRequestDetail>(`/api/pull-request?${query}`, readVersion);
	const stackRead = useRead<StackedPullRequest[]>(`/api/pull-request/stack?${query}`, version);
	const stack = stackRead.data ?? [];
	// Until the stack is read, its members would flash in the list of the others.
	const others = stackRead.data || stackRead.error ? session.filter(other => !samePullRequest(other, pr) && !stack.some(member => samePullRequest(member, other))) : [];
	const queued = useQueuedSave({ replace, reload: () => setReads(count => count + 1), onSaved });
	const save = (change: PullRequestChange, shown: Partial<PullRequestDetail>): void => {
		if (detail) queued.save({ ...detail, ...shown }, () => putJson<PullRequestDetail>("/api/pull-request", { owner: pr.owner, repo: pr.repo, number: pr.number, change }));
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
		else if (value !== "code" && files) location.hash = hashForInbox(pr);
	};
	// GitHub's search, which the inbox reads, can list a pull request for a while after it closes.
	const next = detail?.state === "closed" ? null : listedNext;
	const offered = quick.actions.filter(action => action !== next?.action);
	const placed = detail ? placeFixes(pullRequestStatus(detail), offered) : [];
	const otherActions = detail || error ? offered.filter(action => !placed.some(({ fix }) => fix === action)) : [];
	const page = placement === "page";
	const comments = detail ? detail.conversation.length + detail.threads.length : 0;
	return (
		<div className={cn("@container/pr flex min-h-0 flex-col", page && "h-full")}>
			<div className={cn(!page && "sticky top-0 z-10 -mx-4 bg-background px-4")}>
				<DetailHeader pr={pr} detail={detail} stack={stack} next={next} actions={otherActions} quick={quick} onOpen={onOpen} placement={placement} headingRef={headingRef} />
				<div className={cn("flex items-center gap-2 border-b border-border py-2", page && "px-6")}>
					<SizeProvider size="compact">
						<Tabs value={tab} onValueChange={value => choose(value as DetailTab)}>
							<TabsList aria-label="Show">
								<TabItem value="summary" label="Summary" />
								<TabItem value="timeline" label="Timeline" badge={comments || undefined} aria-label={`Timeline, ${comments} comments`} />
								<TabItem value="code" label="Code" />
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
				<div className={cn("min-h-0 flex-1 overflow-y-auto", page && "px-6")}>
					<div className="py-4">
						{tab === "summary" ? <Summary pr={pr} detail={detail} placed={placed} quick={quick} stack={stack} others={others} sessions={sessions} onOpen={onOpen} onPick={onPick} save={save} saveError={queued.error} /> : <Timeline detail={detail} />}
					</div>
				</div>
			)}
		</div>
	);
}
