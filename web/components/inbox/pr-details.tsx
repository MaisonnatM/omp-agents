import {
	ArrowLeft,
	Bot,
	Check,
	CircleCheck,
	CircleDashed,
	CircleDot,
	CircleSlash,
	CircleX,
	Copy,
	Ellipsis,
	ExternalLink,
	Eye,
	FileDiff,
	GitMerge,
	GitPullRequest,
	GitPullRequestDraft,
	Layers,
	type LucideIcon,
	MessageSquare,
	Tag,
	Users,
	Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	type CheckRunState,
	type LinkedPullRequest,
	type PullRequest,
	type PullRequestChange,
	type PullRequestChanges,
	type PullRequestCheck,
	type PullRequestDetail,
	prKey,
	pullRequestUrl,
	type Reviewer,
	type ReviewerState,
	type StackedPullRequest,
	samePullRequest,
} from "../../../src/shared/github";
import type { RosterHost, View } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { graphiteUrl, inboxAge, type MoveId, pullRequestStatus, type StatusItem } from "../../inbox-model";
import { putJson } from "../../api";
import { age, LINK_VERB, modeOf } from "../../labels";
import type { PullRequestActionId } from "../../../src/pull-request-actions";
import { QUICK_ACTIONS, type QuickActionId } from "../../quick-actions";
import { hashForInbox, hashForPullRequestFiles, type OpenMode } from "../../routing";
import { useRead, useReplaceableRead } from "../../reads";
import { useCopy } from "../../use-copy";
import { useQueuedSave } from "../../use-queued-save";
import { ChangesExplorer } from "../changes/changes-explorer";
import { BranchLabel, BranchName } from "../git";
import { OrgIcon } from "../org-icon";
import { QuickActionButton, type QuickActionsProps } from "../quick-actions";
import { LiveSessionChips } from "../session-chip";
import { DetailSection, LoadNote, Markdown } from "../sheet-details";
import { Avatar, IconTip, STATE_ICON } from "./avatars";
import { LabelDot, LabelsField, ReviewersField, type SavePullRequest, StateField, usePullRequestOptions } from "./pr-fields";
import { PullRequestFilesDialog } from "./pr-files-dialog";
import { ChecksIcon, MoveBadge } from "./pr-row";
import { Timeline } from "./pr-timeline";

const CHECK_RUN_ICON: Record<CheckRunState, [LucideIcon, string]> = {
	failing: [CircleX, "text-red-600 dark:text-red-400"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400"],
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400"],
	skipped: [CircleSlash, "text-muted-foreground"],
};

/** Each state's share of the checks bar, in this order. */
const CHECK_BAR: Record<CheckRunState, string> = {
	failing: "bg-red-500",
	pending: "bg-amber-500",
	passing: "bg-emerald-500",
	skipped: "bg-muted-foreground/30",
};

const REVIEWER_ICON: Record<ReviewerState, [LucideIcon, string, string]> = {
	approved: [Check, "text-emerald-600 dark:text-emerald-400", "Approved"],
	"changes-requested": [CircleX, "text-red-600 dark:text-red-400", "Requested changes"],
	commented: [MessageSquare, "text-muted-foreground", "Commented"],
	requested: [CircleDashed, "text-amber-600 dark:text-amber-400", "Review requested"],
};

const AND = new Intl.ListFormat("en", { type: "conjunction" });

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

type Tone = "blocked" | "waiting" | "done";

const TONE_COLOR: Record<Tone, string> = {
	blocked: "text-red-600 dark:text-red-400",
	waiting: "text-amber-600 dark:text-amber-400",
	done: "text-emerald-600 dark:text-emerald-400",
};

interface ItemView<Item> {
	tone: Tone;
	icon: LucideIcon;
	text: (item: Item) => string;
	/** The quick action that works on it. */
	fix?: PullRequestActionId;
}

type StatusView = { [Kind in StatusItem["kind"]]: ItemView<Extract<StatusItem, { kind: Kind }>> };

/** How the details' Status says each fact. */
const STATUS_VIEW: StatusView = {
	ready: { tone: "done", icon: GitMerge, text: () => "Ready to merge" },
	draft: { tone: "waiting", icon: GitPullRequestDraft, text: () => "Draft, not ready for review" },
	conflicts: { tone: "blocked", icon: GitMerge, text: ({ base }) => `Merge conflicts with ${base}`, fix: "resolve-conflicts" },
	"checks-failing": { tone: "blocked", icon: CircleX, text: ({ count }) => `${plural(count, "check")} failed`, fix: "fix-ci" },
	"changes-requested": {
		tone: "blocked",
		icon: CircleX,
		text: ({ by }) => (by.length > 0 ? `Changes requested by ${AND.format(by)}` : "Changes requested"),
		fix: "address-comments",
	},
	threads: { tone: "blocked", icon: MessageSquare, text: ({ count, exact }) => `${count}${exact ? "" : "+"} review ${count === 1 && exact ? "thread" : "threads"} unresolved`, fix: "address-comments" },
	"checks-pending": { tone: "waiting", icon: CircleDashed, text: ({ count }) => `${plural(count, "check")} still running` },
	"review-required": {
		tone: "waiting",
		icon: Eye,
		text: ({ waitingOn }) => (waitingOn.length > 0 ? `Waiting on a review from ${AND.format(waitingOn)}` : "Waiting for a review"),
	},
	approved: { tone: "done", icon: CircleCheck, text: ({ by }) => (by.length > 0 ? `Approved by ${AND.format(by)}` : "Approved") },
	"checks-passing": {
		tone: "done",
		icon: CircleCheck,
		text: ({ passed, skipped }) => `${plural(passed, "check")} passed${skipped > 0 ? `, ${skipped} skipped` : ""}`,
	},
};

const viewOf = <Item extends StatusItem>(item: Item): ItemView<Item> => STATUS_VIEW[item.kind] as ItemView<Item>;

interface PlacedItem {
	item: StatusItem;
	fix: PullRequestActionId | null;
}

/** Each status item with the quick action it offers: one of `actions` that no item above it offers already. */
function placeFixes(items: StatusItem[], actions: QuickActionId[]): PlacedItem[] {
	const offered = new Set<PullRequestActionId>();
	return items.map(item => {
		const { fix } = viewOf(item);
		if (!fix || !actions.includes(fix) || offered.has(fix)) return { item, fix: null };
		offered.add(fix);
		return { item, fix };
	});
}

function CheckRow({ check: { name, state, url } }: { check: PullRequestCheck }) {
	const [Icon, color] = CHECK_RUN_ICON[state];
	return (
		<li className="flex min-w-0 items-center gap-2">
			<Icon aria-label={state} className={cn("size-3.5 shrink-0", color)} />
			{url ? (
				<Tooltip content={name}>
					<a href={url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
						{name}
					</a>
				</Tooltip>
			) : (
				<Tooltip content={name}>
					<span className="truncate">{name}</span>
				</Tooltip>
			)}
		</li>
	);
}

/** A bar of the checks' states, then failing and pending checks in full; passing and skipped ones folded behind their counts. */
function Checks({ checks }: { checks: PullRequestCheck[] }) {
	const waiting = checks.filter(check => check.state === "failing" || check.state === "pending");
	const settled = checks.filter(check => check.state === "passing" || check.state === "skipped");
	const passing = settled.filter(check => check.state === "passing").length;
	const skipped = settled.length - passing;
	const counts = Map.groupBy(checks, check => check.state);
	return (
		<div className="space-y-2 text-xs">
			<div aria-hidden className="flex h-1 gap-px overflow-hidden rounded-full">
				{(Object.keys(CHECK_BAR) as CheckRunState[]).map(state => {
					const count = counts.get(state)?.length ?? 0;
					return count > 0 && <span key={state} className={CHECK_BAR[state]} style={{ flexGrow: count }} />;
				})}
			</div>
			{waiting.length > 0 && (
				<ul className="space-y-1">
					{waiting.map((check, index) => (
						// GitHub can name two runs alike.
						<CheckRow key={index} check={check} />
					))}
				</ul>
			)}
			{settled.length > 0 && (
				<details>
					<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
						{[passing > 0 && `${passing} passing`, skipped > 0 && `${skipped} skipped`].filter(Boolean).join(", ")}
					</summary>
					<ul className="mt-1.5 space-y-1">
						{settled.map((check, index) => (
							<CheckRow key={index} check={check} />
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

/** What the pull request waits on next, as the inbox lists it. */
export interface NextMove {
	move: MoveId;
	reason: string;
	/** The quick action that makes the move, when one applies. */
	action: PullRequestActionId | null;
	/** The running session that works on it or asks you, for the moves an agent holds. */
	session: RosterHost | null;
}

const RAIL = "absolute left-3.5 w-px bg-muted-foreground/30";
const RAIL_DOT = "absolute top-1/2 left-[10.5px] size-2 -translate-y-1/2 rounded-full ring-2 ring-background";

/** The pull requests stacked with this one, top first, on a rail down to the branch the bottom one merges into; each other one links to its details, or `onPick` shows it in place. */
function StackSection({ stack, current, onPick }: { stack: StackedPullRequest[]; current: PullRequest; onPick?: (pr: PullRequest) => void }) {
	const at = stack.findIndex(pr => samePullRequest(pr, current));
	const bottom = stack[stack.length - 1];
	return (
		<DetailSection
			title={
				<>
					<Layers aria-hidden className="size-3.5 self-center" />
					Stack <span className="tabular-nums">{stack.length - at} of {stack.length}</span>
				</>
			}
		>
			<ol className="rounded-md border border-border py-1">
				{stack.map((pr, index) => {
					const here = index === at;
					const label = `#${pr.number} ${pr.title}`;
					return (
						<li key={pr.number} className={cn("relative flex items-center gap-2 py-1.5 pr-3 pl-8 text-sm", here && "bg-muted/60")}>
							<span aria-hidden className={cn(RAIL, index === 0 ? "top-1/2" : "top-0", "bottom-0")} />
							<span aria-hidden className={cn(RAIL_DOT, here ? "bg-primary" : "bg-muted-foreground/60")} />
							<Avatar person={pr.author} label={pr.author.login} />
							{here ? (
								<span aria-current="page" className="min-w-0 flex-1 truncate font-medium">
									{label}
								</span>
							) : onPick ? (
								<button type="button" onClick={() => onPick(pr)} className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline">
									{label}
								</button>
							) : (
								<a href={hashForInbox(pr)} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
									{label}
								</a>
							)}
							<ChecksIcon checks={pr.checks} />
							<span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{inboxAge(pr.updatedAt)}</span>
						</li>
					);
				})}
				<li className="relative py-1.5 pr-3 pl-8 font-mono text-xs text-muted-foreground">
					<span aria-hidden className={cn(RAIL, "top-0 bottom-1/2")} />
					<span aria-hidden className={cn(RAIL_DOT, "bg-background ring-muted-foreground/60")} />
					{bottom.base}
				</li>
			</ol>
		</DetailSection>
	);
}

/** The session's pull requests outside the stack, each shown in place on click. */
function OtherPullRequests({ others, onPick }: { others: LinkedPullRequest[]; onPick: (pr: PullRequest) => void }) {
	return (
		<DetailSection title="Other pull requests of the session">
			<ul className="rounded-md border border-border py-1">
				{others.map(pr => (
					<li key={prKey(pr)}>
						<button type="button" onClick={() => onPick(pr)} className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted">
							<GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1 truncate tabular-nums">
								{pr.repo} #{pr.number}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground">{LINK_VERB[pr.link]}</span>
						</button>
					</li>
				))}
			</ul>
		</DetailSection>
	);
}

interface DetailContentProps {
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

/** The Next move's one button, as the header's primary action. */
function NextMoveButton({ pr, next, quick, onOpen }: { pr: PullRequest; next: NextMove; quick: QuickActionsProps; onOpen: DetailContentProps["onOpen"] }) {
	const { move, reason, action, session } = next;
	let button: ReactNode = null;
	if (action) button = <QuickActionButton action={action} pending={quick.pending} onRun={quick.onRun} primary />;
	else if (move === "merge")
		button = (
			<Button variant="primary" size="compact" leadingIcon={GitMerge} render={<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" />}>
				Merge on GitHub
			</Button>
		);
	else if (session)
		button = (
			<Button variant="primary" size="compact" onClick={event => onOpen({ kind: "live", instanceId: session.instanceId, agentId: null }, modeOf(event))}>
				Open the session
			</Button>
		);
	return (
		<span className="flex items-center gap-2">
			<Tooltip content={reason}>
				<span>
					<MoveBadge move={move} />
				</span>
			</Tooltip>
			{button}
		</span>
	);
}

/** The header's `⋯`: the quick actions the Next move does not make, then the pull request elsewhere. */
function MoreMenu({ pr, actions, quick }: { pr: PullRequest; actions: QuickActionId[]; quick: QuickActionsProps }) {
	return (
		<DropdownMenu>
			<Tooltip content="More actions">
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label="More actions" loading={quick.pending !== null} />}>
					<Ellipsis />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="min-w-56">
				{actions.map(id => (
					<MenuItem key={id} title={QUICK_ACTIONS[id].description} onClick={() => quick.onRun(id)}>
						<Zap />
						{QUICK_ACTIONS[id].label}
					</MenuItem>
				))}
				{actions.length > 0 && <MenuSeparator />}
				<MenuLinkItem href={pullRequestUrl(pr)} target="_blank" rel="noreferrer">
					<OrgIcon org="github" className="size-4" />
					Open on GitHub
				</MenuLinkItem>
				<MenuLinkItem href={graphiteUrl(pr)} target="_blank" rel="noreferrer">
					<OrgIcon org="graphite" className="size-4" />
					Open on Graphite
				</MenuLinkItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function CheckoutCommand({ pr }: { pr: PullRequest }) {
	const { copied, copy } = useCopy();
	const command = `gh pr checkout ${pr.number}`;
	return (
		<Tooltip content={copied ? "Copied" : "Copy the command"}>
			<button type="button" onClick={() => copy(command)} className="group flex shrink-0 items-center gap-1.5 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
				{copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3 opacity-0 group-hover:opacity-100" />}
				{command}
			</button>
		</Tooltip>
	);
}

/** The checks at a glance on the tab bar's right, with the full list in a popover. */
function ChecksSummary({ checks }: { checks: PullRequestCheck[] }) {
	if (checks.length === 0) return null;
	const count = (state: CheckRunState): number => checks.filter(check => check.state === state).length;
	const failing = count("failing");
	const pending = count("pending");
	const [Icon, color, text] =
		failing > 0
			? [CircleX, CHECK_RUN_ICON.failing[1], `${failing} of ${checks.length} failing`]
			: pending > 0
				? [CircleDashed, CHECK_RUN_ICON.pending[1], `${pending} of ${checks.length} running`]
				: [CircleCheck, CHECK_RUN_ICON.passing[1], `${checks.length} passing`];
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" className="text-muted-foreground" aria-label={`Checks: ${text}`}>
					<span className="flex items-center gap-1.5">
						<Icon aria-hidden className={cn("size-4", color)} />
						<span className="hidden tabular-nums @sm/pr:inline">{text}</span>
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-3">
				<Checks checks={checks} />
			</PopoverContent>
		</Popover>
	);
}

function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
	return (
		<>
			<dt className="flex items-center gap-2 pt-1 text-muted-foreground @sm/pr:py-1">
				<Icon aria-hidden className="size-4" />
				{label}
			</dt>
			<dd className="min-w-0 pt-1 pb-2 @sm/pr:py-1">{children}</dd>
		</>
	);
}

function LabelChips({ labels }: { labels: PullRequestDetail["labels"] }) {
	if (labels.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<span className="flex flex-wrap gap-1.5">
			{labels.map(label => (
				<span key={label.name} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs">
					<LabelDot label={label} />
					{label.name}
				</span>
			))}
		</span>
	);
}

function StatusInline({ placed, quick }: { placed: PlacedItem[]; quick: QuickActionsProps }) {
	return (
		<ul className="space-y-1.5">
			{placed.map(({ item, fix }) => {
				const { tone, icon: Icon, text } = viewOf(item);
				return (
					<li key={item.kind} className="flex flex-wrap items-center gap-2">
						<Icon aria-hidden className={cn("size-4 shrink-0", TONE_COLOR[tone])} />
						<span className="min-w-0">{text(item)}</span>
						{fix && <QuickActionButton action={fix} pending={quick.pending} onRun={quick.onRun} />}
					</li>
				);
			})}
		</ul>
	);
}

function ReviewerInline({ reviewers }: { reviewers: Reviewer[] }) {
	if (reviewers.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
			{reviewers.map(reviewer => (
				<span key={reviewer.login} className="flex items-center gap-1.5">
					<Avatar person={reviewer} label={reviewer.login} />
					{reviewer.login}
					<IconTip icon={REVIEWER_ICON[reviewer.state]} />
				</span>
			))}
		</span>
	);
}

interface SummaryProps {
	pr: PullRequest;
	detail: PullRequestDetail;
	placed: PlacedItem[];
	quick: QuickActionsProps;
	stack: StackedPullRequest[];
	/** The session's pull requests outside the stack. */
	others: LinkedPullRequest[];
	sessions: RosterHost[];
	onOpen: DetailContentProps["onOpen"];
	onPick: DetailContentProps["onPick"];
	save: SavePullRequest;
	/** Why GitHub refused the last change; `null` when it took them all. */
	saveError: string | null;
}

function Summary({ pr, detail, placed, quick, stack, others, sessions, onOpen, onPick, save, saveError }: SummaryProps) {
	const options = usePullRequestOptions(detail);
	// The state picker says it is a draft already.
	const blockers = placed.filter(({ item, fix }) => item.kind !== "draft" || fix);
	return (
		<div className="space-y-6">
			{saveError && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					GitHub did not take the change: {saveError}
				</p>
			)}
			<dl className="grid grid-cols-1 items-start gap-x-4 text-sm @sm/pr:grid-cols-[8rem_minmax(0,1fr)] @sm/pr:gap-y-1">
				<Property icon={CircleDot} label="Status">
					<div className="space-y-1.5">
						<StateField detail={detail} save={save} />
						{blockers.length > 0 && <StatusInline placed={blockers} quick={quick} />}
					</div>
				</Property>
				<Property icon={Users} label="Reviewers">
					<ReviewersField detail={detail} options={options} save={save}>
						<ReviewerInline reviewers={detail.reviewers} />
					</ReviewersField>
				</Property>
				<Property icon={Tag} label="Labels">
					<LabelsField detail={detail} options={options} save={save}>
						<LabelChips labels={detail.labels} />
					</LabelsField>
				</Property>
				{sessions.length > 0 && (
					<Property icon={Bot} label="Sessions">
						<LiveSessionChips hosts={sessions} onOpen={onOpen} />
					</Property>
				)}
			</dl>
			{stack.length > 0 && <StackSection stack={stack} current={pr} onPick={onPick} />}
			{others.length > 0 && onPick && <OtherPullRequests others={others} onPick={onPick} />}
			<DetailSection title="Description">{detail.body.trim() ? <Markdown text={detail.body} /> : <p className="text-sm text-muted-foreground">No description.</p>}</DetailSection>
		</div>
	);
}

/** The Code tab: on the page, the changes explorer; in the narrow sidebar, the files, each opening its diff over the page. */
function Code({ pr, detail, placement, path, version }: { pr: PullRequest; detail: PullRequestDetail; placement: Placement; path: string | null; version?: unknown }) {
	const query = `owner=${encodeURIComponent(pr.owner)}&repo=${encodeURIComponent(pr.repo)}&number=${pr.number}`;
	const list = useRead<PullRequestChanges>(placement === "page" ? `/api/pull-request/files?${query}` : null, version);
	const [shown, setShown] = useState<string | null>(null);
	if (placement === "sidebar") {
		return (
			<>
				<ul className="divide-y divide-border rounded-lg border border-border font-mono text-xs">
					{detail.files.map(file => (
						<li key={file.path}>
							<button type="button" onClick={() => setShown(file.path)} className="flex w-full min-w-0 items-center gap-3 px-2.5 py-1 text-left hover:bg-muted">
								<span className="min-w-0 flex-1 truncate">{file.path}</span>
								<span className="shrink-0 tabular-nums">
									<span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span> <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
				{shown !== null && <PullRequestFilesDialog pr={pr} title={detail.title} path={shown} version={version} onClose={() => setShown(null)} />}
			</>
		);
	}
	if (!list.data) {
		return (
			<div className="px-6 py-4">
				<LoadNote loading="Reading changes…" error={list.error && `Cannot load the changes: ${list.error}`} />
			</div>
		);
	}
	if (list.data.files.length === 0) return <p className="m-auto text-sm text-muted-foreground">The pull request changes no file.</p>;
	return (
		<ChangesExplorer
			files={list.data.files}
			path={path}
			hrefFor={file => hashForPullRequestFiles(pr, file)}
			fileUrl={file => `/api/pull-request/file?${query}&path=${encodeURIComponent(file)}`}
			version={String(version ?? 0)}
		/>
	);
}

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
	const Heading = page ? "h1" : "h3";
	const stackedBase = detail && stack.length > 0 && stack.at(-1)?.number !== pr.number;
	const comments = detail ? detail.conversation.length + detail.threads.length : 0;
	return (
		<div className={cn("@container/pr flex min-h-0 flex-col", page && "h-full")}>
			<div className={cn(!page && "sticky top-0 z-10 -mx-4 bg-background px-4")}>
				<header className={cn("space-y-2 border-b border-border pb-4", page ? "px-6 pt-5" : "pt-1")}>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
						<p className="flex min-w-0 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
							{detail && <IconTip icon={STATE_ICON[detail.state]} />}
							<a href={pullRequestUrl(pr)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate hover:text-foreground">
								{pr.owner}/{pr.repo} <span className="text-emerald-700 dark:text-emerald-400">#{pr.number}</span>
								<ExternalLink aria-hidden className="size-3" />
							</a>
						</p>
						<span className="ml-auto flex shrink-0 items-center gap-1.5">
							{next && <NextMoveButton pr={pr} next={next} quick={quick} onOpen={onOpen} />}
							<MoreMenu pr={pr} actions={otherActions} quick={quick} />
						</span>
					</div>
					<Heading ref={headingRef} tabIndex={-1} className={cn(page ? "text-xl" : "text-base", "leading-snug font-semibold outline-none")}>
						{detail?.title ?? `${pr.owner}/${pr.repo}#${pr.number}`}
					</Heading>
					{detail && (
						<>
							<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
								<span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
									<Avatar person={detail.author} label={`Opened by ${detail.author.login}`} />
									<span className="truncate text-foreground">{detail.author.login}</span>
									<span aria-hidden>·</span>
									<Tooltip content={`Opened ${new Date(detail.createdAt).toLocaleString()}`}>
										<span>updated {age(detail.updatedAt)} ago</span>
									</Tooltip>
								</span>
								<span className="ml-auto whitespace-nowrap">
									<CheckoutCommand pr={pr} />
								</span>
							</div>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								<span className="flex min-w-0 max-w-full items-center gap-1.5">
									{stackedBase ? (
										<span className="flex min-w-0 items-center gap-1 text-amber-700 dark:text-amber-400">
											<Layers aria-hidden className="size-3.5 shrink-0" />
											<BranchLabel name={detail.base} title className="max-w-64 font-mono" />
										</span>
									) : (
										<BranchLabel name={detail.base} title className="max-w-64 font-mono" />
									)}
									<ArrowLeft aria-label="from" className="size-3 shrink-0" />
									<BranchName name={detail.head} className="font-mono" />
								</span>
								<span className="ml-auto flex items-center gap-2 tabular-nums">
									<FileDiff aria-hidden className="size-3.5" />
									{detail.changedFiles} {detail.changedFiles === 1 ? "file" : "files"}
									<span className="font-mono">
										<span className="text-emerald-600 dark:text-emerald-400">+{detail.additions.toLocaleString()}</span>{" "}
										<span className="text-red-600 dark:text-red-400">−{detail.deletions.toLocaleString()}</span>
									</span>
								</span>
							</div>
						</>
					)}
				</header>
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
