import {
	ChevronRight,
	CircleCheck,
	CircleDashed,
	CircleX,
	GitMerge,
	GitPullRequest,
	GitPullRequestDraft,
	type LucideIcon,
	RefreshCw,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type {
	CheckState,
	Inbox,
	InboxPullRequest,
	PastSession,
	Person,
	PullRequest,
	RepoInbox,
	ReviewDecision,
	Reviewer,
	ReviewerState,
	RosterHost,
	View,
} from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readJson } from "../settings-api";
import { graphiteUrl, inboxSections, type OpenMode, samePullRequest } from "../view-model";
import { Header } from "./conversation";
import { age, hostLabel, modeOf, pastLabel, projectName } from "./roster";

/** How often the open page asks again; the server answers from its cache in between. */
const POLL_MS = 60_000;

/** Folded repositories and sections: `owner/repo`, and `owner/repo:<section title>`. */
const COLLAPSED_KEY = "omp-agents.inbox-collapsed";

type Load = { phase: "loading" } | { phase: "loaded"; inbox: Inbox; at: number } | { phase: "failed"; error: string };

const STATE_ICON: Record<InboxPullRequest["state"], [LucideIcon, string, string]> = {
	open: [GitPullRequest, "text-emerald-600 dark:text-emerald-400", "Open pull request"],
	draft: [GitPullRequestDraft, "text-muted-foreground", "Draft pull request, not ready for review"],
	merged: [GitMerge, "text-violet-600 dark:text-violet-400", "Merged pull request"],
};

const CHECK_ICON: Record<Exclude<CheckState, "none">, [LucideIcon, string, string]> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400", "Checks on the latest commit passed"],
	failing: [CircleX, "text-red-600 dark:text-red-400", "Checks on the latest commit failed"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400", "Checks on the latest commit are still running"],
};

const REVIEW_LABEL: Record<Exclude<ReviewDecision, "none">, [string, string]> = {
	approved: ["Approved", "text-emerald-600 dark:text-emerald-400"],
	"changes-requested": ["Changes requested", "text-red-600 dark:text-red-400"],
	"review-required": ["Review required", "text-muted-foreground"],
};

/** The dot on a reviewer's picture, and what their tooltip says they did. */
const REVIEWER_STATE: Record<ReviewerState, [string, (login: string) => string]> = {
	approved: ["bg-emerald-500", login => `${login} approved`],
	"changes-requested": ["bg-red-500", login => `${login} requested changes`],
	commented: ["bg-muted-foreground", login => `${login} commented`],
	requested: ["bg-amber-500", login => `Waiting on a review from ${login}`],
};

function storedCollapsed(): Set<string> {
	try {
		const keys: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
		return new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

/** The folded repositories and sections, and a toggle that keeps them in localStorage across reloads. */
function useCollapsed(): [ReadonlySet<string>, (key: string) => void] {
	const [collapsed, setCollapsed] = useState(storedCollapsed);
	const toggle = (key: string): void => {
		const next = new Set(collapsed);
		if (!next.delete(key)) next.add(key);
		setCollapsed(next);
		if (next.size === 0) localStorage.removeItem(COLLAPSED_KEY);
		else localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
	};
	return [collapsed, toggle];
}

interface FoldProps {
	open: boolean;
	onToggle: () => void;
	/** The id of the region the button shows and hides. */
	controls: string;
	children: ReactNode;
	className?: string;
}

function FoldButton({ open, onToggle, controls, children, className }: FoldProps) {
	return (
		<button
			type="button"
			aria-expanded={open}
			aria-controls={controls}
			onClick={onToggle}
			className={cn("-ml-1 flex min-w-0 items-baseline gap-2 rounded px-1 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
		>
			<ChevronRight aria-hidden className={cn("size-3.5 shrink-0 self-center transition-transform", open && "rotate-90")} />
			{children}
		</button>
	);
}

/** An icon with its meaning on hover, and to screen readers. */
function IconTip({ icon: [Icon, color, label], className }: { icon: [LucideIcon, string, string]; className?: string }) {
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className={cn("flex shrink-0", className)}>
				<Icon aria-hidden className={cn("size-4", color)} />
			</span>
		</Tooltip>
	);
}

interface AvatarProps {
	person: Person;
	label: string;
	/** A dot in the corner that marks where a reviewer stands. */
	dot?: string;
	className?: string;
}

function Avatar({ person, label, dot, className }: AvatarProps) {
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className={cn("relative inline-flex size-5 shrink-0 rounded-full bg-muted ring-2 ring-background", className)}>
				{person.avatarUrl ? (
					<img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full rounded-full object-cover" />
				) : (
					<span aria-hidden className="m-auto text-[10px] font-medium uppercase text-muted-foreground">
						{person.login[0]}
					</span>
				)}
				{dot && <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background", dot)} />}
			</span>
		</Tooltip>
	);
}

function Reviewers({ reviewers }: { reviewers: Reviewer[] }) {
	if (reviewers.length === 0) return null;
	return (
		<span className="flex items-center -space-x-1">
			{reviewers.map(reviewer => {
				const [dot, says] = REVIEWER_STATE[reviewer.state];
				return <Avatar key={reviewer.login} person={reviewer} label={says(reviewer.login)} dot={dot} />;
			})}
		</span>
	);
}

interface SessionLink {
	view: View;
	label: string;
}

/** The sessions whose transcripts submitted `pr`, live ones first. */
function sessionsFor(pr: InboxPullRequest, hosts: RosterHost[], past: PastSession[]): SessionLink[] {
	const submitted = (row: { pullRequests: PullRequest[] }): boolean => row.pullRequests.some(other => samePullRequest(other, pr));
	return [
		...hosts.filter(submitted).map((host): SessionLink => ({ view: { kind: "live", instanceId: host.instanceId, agentId: null }, label: hostLabel(host) })),
		...past.filter(submitted).map((session): SessionLink => ({ view: { kind: "past", sessionId: session.sessionId }, label: pastLabel(session) })),
	];
}

interface RowProps {
	pr: InboxPullRequest;
	sessions: SessionLink[];
	onOpen: (view: View, mode: OpenMode) => void;
}

function PullRequestRow({ pr, sessions, onOpen }: RowProps) {
	const review = pr.state === "merged" || pr.review === "none" ? null : REVIEW_LABEL[pr.review];
	return (
		<li className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/50">
			<IconTip icon={STATE_ICON[pr.state]} className="mt-0.5" />
			<Avatar person={pr.author} label={`Opened by ${pr.author.login}`} className="mt-px" />
			<div className="min-w-0 flex-1 space-y-0.5">
				<div className="flex min-w-0 items-baseline gap-2">
					<a
						href={graphiteUrl(pr)}
						target="_blank"
						rel="noreferrer"
						title={`${pr.owner}/${pr.repo}#${pr.number} on Graphite`}
						className="truncate text-sm font-medium underline-offset-2 hover:underline"
					>
						{pr.title}
					</a>
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{pr.number}</span>
				</div>
				<p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
					<span className="truncate font-mono" title={pr.head}>
						{pr.head}
					</span>
					{pr.stackedOn && (
						<span className="truncate" title={`Stacked on ${pr.stackedOn}`}>
							on <span className="font-mono">{pr.stackedOn}</span>
						</span>
					)}
					{pr.role === "reviewer" && <span>· by {pr.author.login}</span>}
					{sessions.slice(0, 3).map(session => (
						<button
							key={session.view.kind === "live" ? session.view.instanceId : session.view.sessionId}
							type="button"
							title="Open the session that submitted it (⌘-click to split)"
							onClick={event => onOpen(session.view, modeOf(event))}
							className="max-w-48 truncate rounded bg-muted px-1.5 py-px text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
						>
							{session.label}
						</button>
					))}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-3 text-xs">
				<Reviewers reviewers={pr.reviewers} />
				{review && <span className={review[1]}>{review[0]}</span>}
				{pr.checks !== "none" && <IconTip icon={CHECK_ICON[pr.checks]} />}
				<span className="w-14 whitespace-nowrap text-right tabular-nums text-muted-foreground" title={new Date(pr.updatedAt).toLocaleString()}>
					{age(pr.updatedAt)}
				</span>
			</div>
		</li>
	);
}

interface RepoProps {
	inbox: RepoInbox;
	hosts: RosterHost[];
	past: PastSession[];
	collapsed: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onOpen: (view: View, mode: OpenMode) => void;
}

function RepoSection({ inbox, hosts, past, collapsed, onToggle, onOpen }: RepoProps) {
	const name = `${inbox.owner}/${inbox.repo}`;
	const key = name.toLowerCase();
	const headingId = `inbox-${name}`;
	const bodyId = `${headingId}-body`;
	const open = !collapsed.has(key);
	const sections = "error" in inbox ? [] : inboxSections(inbox.pullRequests);
	let body: ReactNode;
	if ("error" in inbox) {
		body = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot read {name} from GitHub: {inbox.error}
			</p>
		);
	} else if (sections.length === 0) {
		body = <p className="text-sm text-muted-foreground">No open pull requests of yours and no reviews waiting on you.</p>;
	} else {
		body = sections.map(section => {
			const sectionKey = `${key}:${section.title}`;
			const sectionOpen = !collapsed.has(sectionKey);
			// An id holds no spaces, since `aria-controls` lists ids separated by spaces.
			const listId = `${bodyId}-${section.title.toLowerCase().replaceAll(" ", "-")}`;
			return (
				<div key={section.title} className="space-y-1.5">
					<h4 className="text-xs font-medium text-muted-foreground">
						<FoldButton open={sectionOpen} onToggle={() => onToggle(sectionKey)} controls={listId}>
							{section.title}
							<span className="tabular-nums">{section.pullRequests.length}</span>
						</FoldButton>
					</h4>
					{sectionOpen && (
						<ul id={listId} className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{section.pullRequests.map(pr => (
								<PullRequestRow key={pr.number} pr={pr} sessions={sessionsFor(pr, hosts, past)} onOpen={onOpen} />
							))}
						</ul>
					)}
				</div>
			);
		});
	}
	return (
		<section aria-labelledby={headingId} className="space-y-4">
			<h3 id={headingId} className="text-sm font-semibold">
				<FoldButton open={open} onToggle={() => onToggle(key)} controls={bodyId}>
					{name}
					<span className="truncate text-xs font-normal text-muted-foreground" title={inbox.cwds.join("\n")}>
						{inbox.cwds.length === 1 ? projectName(inbox.cwds[0]!) : `${inbox.cwds.length} workspaces`}
					</span>
				</FoldButton>
			</h3>
			{open && (
				<div id={bodyId} className="space-y-4">
					{body}
				</div>
			)}
		</section>
	);
}

interface InboxPageProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	onOpen: (view: View, mode: OpenMode) => void;
}

/** The pull requests of the sidebar's project, or of every project, in Graphite's inbox sections, read from GitHub. */
export function InboxPage({ project, hosts, past, onOpen }: InboxPageProps) {
	const [load, setLoad] = useState<Load>({ phase: "loading" });
	const [refreshing, setRefreshing] = useState(false);
	const controller = useRef<AbortController | null>(null);
	const [collapsed, toggleCollapsed] = useCollapsed();

	const fetchInbox = useCallback(
		async (fresh: boolean): Promise<void> => {
			controller.current?.abort();
			const current = new AbortController();
			controller.current = current;
			const params = new URLSearchParams();
			if (project !== null) params.set("cwd", project);
			if (fresh) params.set("fresh", "");
			setRefreshing(true);
			try {
				const inbox = await readJson<Inbox>(await fetch(`/api/inbox${params.size ? `?${params}` : ""}`, { signal: current.signal }));
				setLoad({ phase: "loaded", inbox, at: Date.now() });
			} catch (err) {
				if (!current.signal.aborted) setLoad({ phase: "failed", error: err instanceof Error ? err.message : String(err) });
			} finally {
				if (controller.current === current) setRefreshing(false);
			}
		},
		[project],
	);

	useEffect(() => {
		setLoad({ phase: "loading" });
		void fetchInbox(false);
		const timer = setInterval(() => void fetchInbox(false), POLL_MS);
		return () => {
			clearInterval(timer);
			controller.current?.abort();
		};
	}, [fetchInbox]);

	let body: ReactNode;
	if (load.phase === "loading") body = <p className="text-sm text-muted-foreground">Asking GitHub for pull requests…</p>;
	else if (load.phase === "failed") body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot load the inbox: {load.error}</p>;
	else {
		const { repos, unmatched } = load.inbox;
		body = (
			<>
				{repos.length === 0 && <p className="text-sm text-muted-foreground">No session ran in a GitHub repository.</p>}
				{repos.map(repo => (
					<RepoSection
						key={`${repo.owner}/${repo.repo}`}
						inbox={repo}
						hosts={hosts}
						past={past}
						collapsed={collapsed}
						onToggle={toggleCollapsed}
						onOpen={onOpen}
					/>
				))}
				{unmatched.length > 0 && (
					<p className="text-xs text-muted-foreground" title={unmatched.join("\n")}>
						{unmatched.length === 1 ? "1 workspace has" : `${unmatched.length} workspaces have`} no GitHub origin and is left out.
					</p>
				)}
			</>
		);
	}

	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header
				title="Inbox"
				meta={
					load.phase === "loaded"
						? `Your pull requests and review requests on GitHub · updated ${new Date(load.at).toLocaleTimeString()}`
						: "Your pull requests and review requests on GitHub"
				}
			>
				<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={() => void fetchInbox(true)}>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<TooltipProvider>
					<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">{body}</div>
				</TooltipProvider>
			</div>
		</div>
	);
}
