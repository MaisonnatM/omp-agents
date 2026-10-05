import { CircleCheck, CircleDashed, CircleSlash, CircleX, Eye, GitMerge, GitPullRequestDraft, type LucideIcon, MessageSquare } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { CheckRunState, PullRequest, PullRequestCheck, PullRequestDetail, PullRequestEvent, RosterHost, View } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { graphiteUrl, pullRequestStatus, pullRequestUrl, type StatusItem } from "../../inbox-model";
import { age } from "../../labels";
import type { PullRequestActionId, QuickActionId } from "../../quick-actions";
import type { OpenMode } from "../../routing";
import { useRead } from "../../reads";
import { BranchName } from "../git";
import { QuickActionButton, QuickActionButtons } from "../quick-actions";
import { LiveSessionChips } from "../session-chip";
import { Comment, DetailSection, Markdown, OutLink, SheetFrame } from "../sheet-details";
import { Avatar, IconTip, STATE_ICON } from "./avatars";

const CHECK_RUN_ICON: Record<CheckRunState, [LucideIcon, string]> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400"],
	failing: [CircleX, "text-red-600 dark:text-red-400"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400"],
	skipped: [CircleSlash, "text-muted-foreground"],
};

/** What a comment or review did, after its author's name. */
const EVENT_ACTION: Record<NonNullable<PullRequestEvent["review"]> | "comment", string> = {
	approved: "approved",
	"changes-requested": "requested changes",
	commented: "reviewed",
	dismissed: "reviewed, since dismissed",
	comment: "commented",
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

/** How the sheet's Status says each fact. */
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
	threads: { tone: "blocked", icon: MessageSquare, text: ({ count }) => `${plural(count, "review thread")} unresolved`, fix: "address-comments" },
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

/** The quick actions a sheet offers on its pull request: those that apply, the one starting, and their start. */
export interface SheetActions {
	actions: PullRequestActionId[];
	pending: QuickActionId | null;
	onRun: (action: PullRequestActionId) => void;
}

interface PlacedItem {
	item: StatusItem;
	fix: PullRequestActionId | null;
}

/** Each status item with the quick action it offers: one that applies and that no item above it offers already. */
function placeFixes(items: StatusItem[], quick: SheetActions | undefined): PlacedItem[] {
	const offered = new Set<PullRequestActionId>();
	return items.map(item => {
		const { fix } = viewOf(item);
		if (!fix || !quick?.actions.includes(fix) || offered.has(fix)) return { item, fix: null };
		offered.add(fix);
		return { item, fix };
	});
}

function Status({ placed, quick }: { placed: PlacedItem[]; quick: SheetActions | undefined }) {
	return (
		<ul className="space-y-1.5 text-sm">
			{placed.map(({ item, fix }) => {
				const { tone, icon: Icon, text } = viewOf(item);
				return (
					<li key={item.kind} className="flex min-h-7 items-center gap-2">
						<Icon aria-hidden className={cn("size-4 shrink-0", TONE_COLOR[tone])} />
						<span className="min-w-0 flex-1">{text(item)}</span>
						{fix && quick && <QuickActionButton action={fix} pending={quick.pending} onRun={quick.onRun} />}
					</li>
				);
			})}
		</ul>
	);
}

/** How tall a description shows before it folds, in px, as `max-h-64`. One only a little taller shows in full. */
const CLAMP_PX = 256;
const CLAMP_SLACK_PX = 48;

/** `children` cut at {@link CLAMP_PX} with a Show more button, when they are taller. */
function Clamped({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [tall, setTall] = useState(false);
	const [open, setOpen] = useState(false);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = (): void => setTall(element.scrollHeight > CLAMP_PX + CLAMP_SLACK_PX);
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, []);
	const clamped = tall && !open;
	return (
		<div className="space-y-1">
			<div ref={ref} className={cn(clamped && "max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]")}>
				{children}
			</div>
			{tall && (
				<Button variant="ghost" size="compact" className="-ml-2 text-muted-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
					{open ? "Show less" : "Show more"}
				</Button>
			)}
		</div>
	);
}

function CheckRow({ check: { name, state, url } }: { check: PullRequestCheck }) {
	const [Icon, color] = CHECK_RUN_ICON[state];
	return (
		<li className="flex min-w-0 items-center gap-2">
			<Icon aria-label={state} className={cn("size-3.5 shrink-0", color)} />
			{url ? (
				<a href={url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
					{name}
				</a>
			) : (
				<span className="truncate">{name}</span>
			)}
		</li>
	);
}

/** Failing and pending checks in full; passing and skipped ones folded behind their counts. */
function Checks({ checks }: { checks: PullRequestCheck[] }) {
	const waiting = checks.filter(check => check.state === "failing" || check.state === "pending");
	const settled = checks.filter(check => check.state === "passing" || check.state === "skipped");
	const passing = settled.filter(check => check.state === "passing").length;
	const skipped = settled.length - passing;
	return (
		<div className="space-y-1.5 text-xs">
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

interface SheetContentProps {
	pr: PullRequest;
	/** The quick actions on it; none when the inbox does not list it, since a start needs the workspace the inbox names. */
	quick?: SheetActions;
	/** The running sessions that work on it. */
	sessions: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
	/** What became of the last quick action on it. */
	notice?: ReactNode;
}

/**
 * A pull request read from GitHub, as the inbox's sheet shows it: a header that names it, then its Status, where each
 * blocker offers the quick action that works on it, then its details. The header offers the other quick actions, and
 * every one when the read failed, so the buttons do not move once the details arrive, then the sessions that work on it.
 */
export function PullRequestSheetContent({ pr, quick, sessions, onOpen, notice }: SheetContentProps) {
	const { data: detail, error } = useRead<PullRequestDetail>(`/api/pull-request?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}`);
	const name = `${pr.owner}/${pr.repo}#${pr.number}`;
	const placed = detail ? placeFixes(pullRequestStatus(detail), quick) : [];
	const headerActions = quick && (detail || error) ? quick.actions.filter(action => !placed.some(({ fix }) => fix === action)) : [];
	return (
		<SheetFrame
			title={detail?.title ?? name}
			icon={detail && <IconTip icon={STATE_ICON[detail.state]} className="mt-1" />}
			loading="Asking GitHub for the pull request…"
			error={error && `Cannot load the pull request: ${error}`}
			actions={
				<>
					{(headerActions.length > 0 || sessions.length > 0) && (
						<div className="flex flex-wrap items-center gap-2">
							{quick && <QuickActionButtons actions={headerActions} pending={quick.pending} onRun={quick.onRun} />}
							<LiveSessionChips hosts={sessions} onOpen={onOpen} />
						</div>
					)}
					{notice}
				</>
			}
			meta={
				<>
					<span className="tabular-nums">{name}</span>
					{detail && (
						<>
							<span className="min-w-0 truncate">
								<BranchName name={detail.head} className="font-mono" /> into <span className="font-mono">{detail.base}</span>
							</span>
							<span className="tabular-nums">
								<span className="text-emerald-600 dark:text-emerald-400">+{detail.additions}</span>{" "}
								<span className="text-red-600 dark:text-red-400">−{detail.deletions}</span> in {detail.changedFiles}{" "}
								{detail.changedFiles === 1 ? "file" : "files"}
							</span>
							<span title={new Date(detail.createdAt).toLocaleString()}>
								opened by {detail.author.login} {age(detail.createdAt)} ago
							</span>
						</>
					)}
					<span className="ml-auto flex gap-3">
						<OutLink href={pullRequestUrl(pr)}>GitHub</OutLink>
						<OutLink href={graphiteUrl(pr)}>Graphite</OutLink>
					</span>
				</>
			}
		>
			{detail ? <PullRequestSections detail={detail} status={placed.length > 0 && <Status placed={placed} quick={quick} />} /> : null}
		</SheetFrame>
	);
}

/** A pull request's status, description, checks, unresolved comments, conversation, and files. */
function PullRequestSections({ detail, status }: { detail: PullRequestDetail; status: ReactNode }) {
	const { body, checks, threads, conversation, files } = detail;
	return (
		<>
			{status && <DetailSection title="Status">{status}</DetailSection>}
			<DetailSection title="Description">
				{body.trim() ? (
					<Clamped>
						<Markdown text={body} />
					</Clamped>
				) : (
					<p className="text-sm text-muted-foreground">No description.</p>
				)}
			</DetailSection>
			{checks.length > 0 && (
				<DetailSection title="Checks">
					<Checks checks={checks} />
				</DetailSection>
			)}
			{threads.length > 0 && (
				<DetailSection
					title={
						<>
							Unresolved comments <span className="tabular-nums">{threads.length}</span>
						</>
					}
				>
					<ul className="space-y-3">
						{threads.map((thread, index) => (
							<li key={index} className="space-y-3 rounded-md border border-border p-3">
								<p className="truncate font-mono text-xs text-muted-foreground" title={thread.path}>
									{thread.path}
									{thread.line !== null && `:${thread.line}`}
								</p>
								<ul className="space-y-3">
									{thread.comments.map((comment, position) => (
										<Comment
											key={position}
											comment={comment}
											avatar={<Avatar person={comment.author} label={comment.author.login} className="mr-0.5" />}
											author={comment.author.login}
											action={position === 0 ? "commented" : "replied"}
										/>
									))}
								</ul>
							</li>
						))}
					</ul>
				</DetailSection>
			)}
			{conversation.length > 0 && (
				<DetailSection title="Conversation">
					<ul className="space-y-4">
						{conversation.map((event, index) => (
							<Comment
								key={index}
								comment={event}
								avatar={<Avatar person={event.author} label={event.author.login} className="mr-0.5" />}
								author={event.author.login}
								action={EVENT_ACTION[event.review ?? "comment"]}
							/>
						))}
					</ul>
				</DetailSection>
			)}
			{files.length > 0 && (
				<DetailSection
					title={
						<>
							Files <span className="tabular-nums">{detail.changedFiles}</span>
						</>
					}
				>
					<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border font-mono text-xs">
						{files.map(file => (
							<li key={file.path} className="flex min-w-0 items-center gap-3 px-2.5 py-1">
								<span className="min-w-0 flex-1 truncate" title={`${file.path} (${file.change})`}>
									{file.path}
								</span>
								<span className="shrink-0 tabular-nums">
									<span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{" "}
									<span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
								</span>
							</li>
						))}
					</ul>
					{detail.changedFiles > files.length && (
						<p className="text-xs text-muted-foreground">
							And {detail.changedFiles - files.length} more files, which <OutLink href={`${pullRequestUrl(detail)}/files`}>GitHub</OutLink> lists.
						</p>
					)}
				</DetailSection>
			)}
		</>
	);
}
