import { ChevronRight, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Inbox, PastSession, PullRequest, RepoInbox, RosterHost, View } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type InboxTarget, inboxRepoKey, inboxSectionId, inboxSections, samePullRequest } from "../../inbox-model";
import { projectName } from "../../labels";
import { hashForInbox, type OpenMode } from "../../routing";
import { refreshInbox, useInbox } from "../../use-inbox";
import { Header } from "../conversation";
import { PullRequestSheetContent } from "./pr-details";
import { PullRequestRow, rowId, sessionsFor } from "./pr-row";

/** Folded repositories and sections: `owner/repo`, and `owner/repo:<section title>`. */
const COLLAPSED_KEY = "omp-agents.inbox-collapsed";

function storedCollapsed(): Set<string> {
	try {
		const keys: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
		return new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

/** The folded repositories and sections, a toggle, and an unfold for a row the page must show; localStorage keeps them across reloads. */
function useCollapsed(): [ReadonlySet<string>, (key: string) => void, (keys: string[]) => void] {
	const [collapsed, setCollapsed] = useState(storedCollapsed);
	const store = (next: Set<string>): void => {
		setCollapsed(next);
		if (next.size === 0) localStorage.removeItem(COLLAPSED_KEY);
		else localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
	};
	const toggle = (key: string): void => {
		const next = new Set(collapsed);
		if (!next.delete(key)) next.add(key);
		store(next);
	};
	const expand = (keys: string[]): void => {
		const next = new Set(collapsed);
		if (keys.filter(key => next.delete(key)).length > 0) store(next);
	};
	return [collapsed, toggle, expand];
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

interface RepoProps {
	inbox: RepoInbox;
	hosts: RosterHost[];
	past: PastSession[];
	target: PullRequest | null;
	collapsed: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onOpen: (view: View, mode: OpenMode) => void;
}

function RepoSection({ inbox, hosts, past, target, collapsed, onToggle, onOpen }: RepoProps) {
	const name = `${inbox.owner}/${inbox.repo}`;
	const key = inboxRepoKey(inbox);
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
			const sectionId = inboxSectionId({ repo: key, title: section.title });
			const listId = `${sectionId}-list`;
			return (
				// Focused when its sidebar link is chosen.
				<div key={section.title} id={sectionId} tabIndex={-1} className="scroll-mt-6 space-y-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<h4 className="text-xs font-medium text-muted-foreground">
						<FoldButton open={sectionOpen} onToggle={() => onToggle(sectionKey)} controls={listId}>
							{section.title}
							<span className="tabular-nums">{section.pullRequests.length}</span>
						</FoldButton>
					</h4>
					{sectionOpen && (
						<ul id={listId} className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{section.pullRequests.map(pr => (
								<PullRequestRow
									key={pr.number}
									pr={pr}
									sessions={sessionsFor(pr, hosts, past)}
									targeted={target !== null && samePullRequest(pr, target)}
									onOpen={onOpen}
								/>
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

/** The fold keys of the repository and the section that list `pr`, or `null` when the inbox does not list it. */
function placeOf(inbox: Inbox, pr: PullRequest): { repo: string; section: string } | null {
	for (const repo of inbox.repos) {
		if ("error" in repo) continue;
		const section = inboxSections(repo.pullRequests).find(({ pullRequests }) => pullRequests.some(other => samePullRequest(other, pr)));
		const key = `${repo.owner}/${repo.repo}`.toLowerCase();
		if (section) return { repo: key, section: `${key}:${section.title}` };
	}
	return null;
}

/** Why the inbox does not list the PR a link named. `allProjects`: the sidebar shows every project. */
function MissingTarget({ target, inbox, allProjects }: { target: PullRequest; inbox: Inbox; allProjects: boolean }) {
	const repo = `${target.owner}/${target.repo}`;
	const covered = inbox.repos.some(other => `${other.owner}/${other.repo}`.toLowerCase() === repo.toLowerCase());
	let reason = `${repo}#${target.number} is not in this inbox, which covers only the project that the sidebar shows. Choose All projects in the sidebar to include ${repo}.`;
	if (covered) {
		reason = `${repo}#${target.number} is not in this inbox. The inbox lists your open pull requests, your merges from the last seven days, and the pull requests that wait for your review.`;
	} else if (allProjects) {
		reason = `${repo}#${target.number} is not in this inbox, because no session ran in ${repo}.`;
	}
	return (
		<p role="status" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
			{reason}
		</p>
	);
}

interface InboxPageProps {
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The PR an inbox link named: its row unfolds, scrolls into view, and stays highlighted while its details show in a sheet. */
	target: PullRequest | null;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The section a sidebar link last chose, to unfold, scroll to, and focus. */
	section: InboxTarget | null;
}

/** The pull requests of the sidebar's project, or of every project, in Graphite's inbox sections, read from GitHub. */
export function InboxPage({ project, hosts, past, target, onOpen, section }: InboxPageProps) {
	const { read, error, refreshing } = useInbox(project, true);
	const [collapsed, toggleCollapsed, expand] = useCollapsed();
	const place = read && target ? placeOf(read.inbox, target) : null;
	const targetKey = target && rowId(target);
	/** The target whose row the page already unfolded and scrolled to; folding it again afterwards stays folded. */
	const shown = useRef<string | null>(null);
	/** The sidebar section the page already unfolded, scrolled to, and focused. */
	const revealed = useRef<InboxTarget | null>(null);
	/** The PR the sheet shows, kept after the hash drops it so the sheet's content stays through its exit slide. */
	const sheetPr = useRef<PullRequest | null>(null);
	if (target) sheetPr.current = target;

	useEffect(() => {
		if (!place || !targetKey || shown.current === targetKey) return;
		const folded = [place.repo, place.section].filter(key => collapsed.has(key));
		if (folded.length > 0) {
			// Unfolding renders the row; this effect runs again and then scrolls to it.
			expand(folded);
			return;
		}
		shown.current = targetKey;
		document.getElementById(targetKey)?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [place?.repo, place?.section, targetKey, collapsed]);

	// Waits for the section to unfold, and for an inbox that has it to load.
	useEffect(() => {
		if (!section || revealed.current === section) return;
		const folds = [section.repo, `${section.repo}:${section.title}`];
		if (folds.some(key => collapsed.has(key))) return expand(folds);
		const element = document.getElementById(inboxSectionId(section));
		if (!element) return;
		revealed.current = section;
		element.scrollIntoView({ block: "start" });
		element.focus({ preventScroll: true });
	});

	let body: ReactNode;
	if (!read && error) body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot load the inbox: {error}</p>;
	else if (!read) body = <p className="text-sm text-muted-foreground">Asking GitHub for pull requests…</p>;
	else {
		const { repos, unmatched } = read.inbox;
		body = (
			<>
				{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the inbox: {error}</p>}
				{target && !place && <MissingTarget target={target} inbox={read.inbox} allProjects={project === null} />}
				{repos.length === 0 && <p className="text-sm text-muted-foreground">No session ran in a GitHub repository.</p>}
				{repos.map(repo => (
					<RepoSection
						key={`${repo.owner}/${repo.repo}`}
						inbox={repo}
						hosts={hosts}
						past={past}
						target={target}
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
					read
						? `Your pull requests and review requests on GitHub · updated ${
								new Date(read.at).toDateString() === new Date().toDateString()
									? new Date(read.at).toLocaleTimeString()
									: new Date(read.at).toLocaleString()
							}`
						: "Your pull requests and review requests on GitHub"
				}
			>
				<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={() => void refreshInbox(project, true)}>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<TooltipProvider>
					<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">{body}</div>
					{sheetPr.current && (
						<Sheet open={target !== null} onClose={() => (location.hash = hashForInbox(null))}>
							<PullRequestSheetContent key={rowId(sheetPr.current)} pr={sheetPr.current} />
						</Sheet>
					)}
				</TooltipProvider>
			</div>
		</div>
	);
}
