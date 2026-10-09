import { Bell, CheckCheck, CircleX, Eye, GitCompareArrows, GitMerge, type LucideIcon, MessageSquare, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Person, pullRequestUrl } from "../../src/shared/github";
import type { YourMove } from "../../src/shared/moves";
import { type Notice, usesClause } from "../../src/shared/notices";
import type { ClientMsg } from "../../src/shared/protocol";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { moveAction } from "../inbox-model";
import { readPinnedSkill } from "../pinned-skill";
import { pendingOf, pullRequestStart, QUICK_ACTIONS } from "../quick-actions";
import { hashForInbox } from "../routing";
import { Age } from "./age";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { SLACK_LOGO } from "./integrations/brand-logos";
import { toasts } from "./toaster";

type Send = (msg: ClientMsg) => void;
type UpdateNotice = Extract<Notice, { status: unknown }>;

/** The bell's filters, each a source of notices. */
type Source = "github" | "slack" | "updates";

const sourceOf = (notice: Notice): Source => (notice.kind === "pull-request" ? "github" : notice.kind === "slack" ? "slack" : "updates");

const FILTERS: [Source | "all", string][] = [
	["all", "All"],
	["github", "GitHub"],
	["slack", "Slack"],
	["updates", "Updates"],
];

/** A pull request toast or Slack toast shows only while its news is this fresh, so a check after a long gap does not toast what you missed. */
const TOAST_FRESH_MS = 15 * 60_000;
/** How long a pull request toast or Slack toast stays; an update's stays until dismissed. */
const TOAST_MS = 6_000;

/** Each of your moves as the bell words it, with the icon and colours of the inbox's badge for it. */
const MOVE_NOTICE: Record<YourMove, { headline: string; icon: LucideIcon; tone: string }> = {
	review: { headline: "Review requested", icon: Eye, tone: "bg-blue-500 text-white" },
	merge: { headline: "Ready to merge", icon: GitMerge, tone: "bg-emerald-500 text-white" },
	"fix-ci": { headline: "Checks failed", icon: CircleX, tone: "bg-red-500 text-white" },
	rebase: { headline: "Conflicts to resolve", icon: GitCompareArrows, tone: "bg-orange-500 text-white" },
	reply: { headline: "Comments to address", icon: MessageSquare, tone: "bg-amber-500 text-white" },
};

function updateTitle(notice: UpdateNotice): string {
	return `${notice.kind === "omp" ? `omp ${notice.latest}` : notice.to.name} is out`;
}

function updateDetail(notice: UpdateNotice): string {
	switch (notice.status.state) {
		case "available":
			return notice.kind === "omp" ? `You run omp ${notice.current}.` : `${usesClause(notice.uses)} ${notice.from.name}.`;
		case "updating":
			return notice.kind === "omp" ? "Updating omp…" : `Switching to ${notice.to.name}…`;
		case "updated":
			return notice.status.note;
		case "failed":
			return notice.status.error;
	}
}

/** What a notice says in one line, as its toast's title and its row's headline. */
function headlineOf(notice: Notice): string {
	switch (notice.kind) {
		case "pull-request":
			return `${MOVE_NOTICE[notice.move].headline} · ${notice.pr.repo}#${notice.pr.number}`;
		case "slack":
			if (notice.type === "mention") return `${notice.from} mentioned you in #${notice.channel}`;
			if (notice.type === "group-dm") return `${notice.from} wrote in a group message`;
			return notice.count === 1 ? `${notice.from} sent you a message` : `${notice.from} sent you ${notice.count} messages`;
		default:
			return updateTitle(notice);
	}
}

/** What a notice says after its headline. */
function previewOf(notice: Notice): string {
	switch (notice.kind) {
		case "pull-request":
			return notice.pr.title;
		case "slack":
			return notice.text;
		default:
			return updateDetail(notice);
	}
}

/** Opens what a pull request notice or Slack notice is about: the pull request in the inbox, or the message in Slack. */
function follow(notice: Notice): void {
	if (notice.kind === "pull-request") location.hash = hashForInbox(notice.pr);
	else if (notice.kind === "slack") window.open(notice.permalink, "_blank", "noopener,noreferrer");
}

/** Whether **Update** is enabled: before the update runs, and again after it failed. */
const updatable = (notice: UpdateNotice): boolean => notice.status.state === "available" || notice.status.state === "failed";

/**
 * Shows each notice the user has not seen as a toast; closing it marks the notice seen, so it toasts once across reloads
 * and pages. An update's toast stays until dismissed and keeps its text and **Update** in step with the notice. A pull
 * request's or Slack message's toast shows only while its news is fresh, closes itself, and opens what it is about.
 */
export function useNoticeToasts(notices: Notice[], connected: boolean, send: Send): void {
	const open = useRef(new Set<string>());
	useEffect(() => {
		const close = (id: string) => {
			open.current.delete(id);
			toasts.close(id);
		};
		const listed = new Set(notices.map(({ id }) => id));
		for (const id of open.current) if (!listed.has(id)) close(id);
		for (const notice of notices) {
			const { id } = notice;
			const onClose = () => {
				if (open.current.delete(id)) send({ t: "notice", ids: [id], op: "seen" });
			};
			if (notice.kind === "pull-request" || notice.kind === "slack") {
				if (open.current.has(id)) {
					if (notice.read) close(id);
					continue;
				}
				if (notice.seen || notice.read || Date.now() - notice.at > TOAST_FRESH_MS) continue;
				open.current.add(id);
				toasts.add({
					id,
					timeout: TOAST_MS,
					onClose,
					title: headlineOf(notice),
					description: <span className="line-clamp-2">{previewOf(notice)}</span>,
					actionProps: {
						children: "Open",
						onClick: () => {
							follow(notice);
							send({ t: "notice", ids: [id], op: "read" });
						},
					},
				});
				continue;
			}
			const content = {
				title: headlineOf(notice),
				actionProps:
					notice.status.state === "updated"
						? undefined
						: {
								children: notice.status.state === "updating" ? "Updating" : "Update",
								disabled: !connected || !updatable(notice),
								onClick: () => send({ t: "notice", ids: [id], op: "update" }),
							},
				description: previewOf(notice),
			};
			const dismissedElsewhere = notice.seen && notice.status.state === "available";
			if (!open.current.has(id)) {
				if (notice.seen) continue;
				open.current.add(id);
				toasts.add({ id, timeout: 0, onClose, ...content });
			} else if (dismissedElsewhere) {
				close(id);
			} else {
				toasts.update(id, content);
			}
		}
	}, [notices, connected, send]);
}

/** Who made a pull request your move: the author who asked for your review, the reviewer who asked for changes or commented, or the one who approved. */
function actorOf(notice: Extract<Notice, { kind: "pull-request" }>): Person | null {
	const { pr, move } = notice;
	if (move === "review") return pr.author;
	if (move === "reply") return pr.reviewers.find(({ state }) => state === "changes-requested") ?? pr.reviewers.find(({ state }) => state === "commented") ?? null;
	if (move === "merge") return pr.reviewers.find(({ state }) => state === "approved") ?? null;
	return null;
}

const BADGE = "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2 ring-popover";

/** A notice's picture: who it comes from with a badge for its source, or for an update or a move nobody made, the source's tile. */
function Face({ notice }: { notice: Notice }) {
	if (notice.kind === "omp" || notice.kind === "model") {
		return (
			<span className="relative mt-0.5 flex size-8 shrink-0 rounded-lg bg-violet-500/10">
				<Sparkles aria-hidden className="m-auto size-4 text-violet-600 dark:text-violet-400" />
			</span>
		);
	}
	let person: { name: string; avatarUrl: string | null } | null;
	let badge: ReactNode;
	if (notice.kind === "pull-request") {
		const { icon: Icon, tone } = MOVE_NOTICE[notice.move];
		const actor = actorOf(notice);
		if (!actor) {
			return (
				<span className={cn("relative mt-0.5 flex size-8 shrink-0 rounded-full", tone)}>
					<Icon aria-hidden className="m-auto size-4" />
				</span>
			);
		}
		person = { name: actor.login, avatarUrl: actor.avatarUrl };
		badge = (
			<span className={cn(BADGE, tone)}>
				<Icon aria-hidden className="size-2.5" strokeWidth={2.5} />
			</span>
		);
	} else {
		person = { name: notice.from, avatarUrl: null };
		badge = (
			<span className={cn(BADGE, "bg-popover")}>
				<svg aria-hidden viewBox="0 0 24 24" className="size-3" fill={SLACK_LOGO.color}>
					<path d={SLACK_LOGO.path} />
				</svg>
			</span>
		);
	}
	return (
		<span className="relative mt-0.5 flex size-8 shrink-0 rounded-full bg-muted">
			{person.avatarUrl ? (
				<img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full rounded-full object-cover" />
			) : (
				<span aria-hidden className="m-auto text-xs font-semibold uppercase text-muted-foreground">
					{person.name[0]}
				</span>
			)}
			{badge}
		</span>
	);
}

/** A notice's button: **Update**, the quick action that makes a pull request's move, or **Merge on GitHub**. */
function NoticeAction({ notice, send, onDone }: { notice: Notice; send: Send; onDone: () => void }) {
	const { start } = useDashboardActions();
	const { connected, starts } = useDashboardStatus();
	if (notice.kind === "slack") return null;
	if (notice.kind === "omp" || notice.kind === "model") {
		if (notice.status.state === "updated") return null;
		return (
			<Button variant="secondary" size="compact" disabled={!connected || !updatable(notice)} onClick={() => send({ t: "notice", ids: [notice.id], op: "update" })}>
				{notice.status.state === "updating" ? "Updating" : "Update"}
			</Button>
		);
	}
	const { pr, move, cwd } = notice;
	const read = () => send({ t: "notice", ids: [notice.id], op: "read" });
	if (move === "merge") {
		return (
			<Button variant="secondary" size="compact" asChild>
				<a
					href={pullRequestUrl(pr)}
					target="_blank"
					rel="noreferrer"
					onClick={() => {
						read();
						onDone();
					}}
				>
					Merge on GitHub
				</a>
			</Button>
		);
	}
	const action = moveAction(pr, move);
	if (!action) return null;
	const pending = pendingOf(starts.quick, { kind: "pull-request", pr }) !== null;
	return (
		<Button
			variant="secondary"
			size="compact"
			disabled={!connected || pending}
			onClick={() => {
				start(pullRequestStart(pr, action, cwd, readPinnedSkill()));
				read();
				onDone();
				location.hash = hashForInbox(pr);
			}}
		>
			{QUICK_ACTIONS[action].label}
		</Button>
	);
}

function NoticeRow({ notice, send, onDone }: { notice: Notice; send: Send; onDone: () => void }) {
	const { connected } = useDashboardStatus();
	const headline = headlineOf(notice);
	const preview = previewOf(notice);
	const failed = "status" in notice && notice.status.state === "failed";
	const read = () => {
		if (!notice.read) send({ t: "notice", ids: [notice.id], op: "read" });
	};
	const href = notice.kind === "pull-request" ? hashForInbox(notice.pr) : notice.kind === "slack" ? notice.permalink : null;
	const label = `${notice.read ? "" : "Unread: "}${headline}`;
	return (
		<li className="group relative flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/70 has-[>a:focus-visible]:bg-muted/70">
			{href ? (
				<a
					href={href}
					target={notice.kind === "slack" ? "_blank" : undefined}
					rel={notice.kind === "slack" ? "noreferrer" : undefined}
					aria-label={label}
					className="absolute inset-0 rounded-lg focus-visible:outline-none"
					onClick={() => {
						read();
						onDone();
					}}
				/>
			) : (
				<button type="button" aria-label={notice.read ? headline : `Mark read: ${headline}`} className="absolute inset-0 rounded-lg focus-visible:outline-none" onClick={read} />
			)}
			{!notice.read && <span aria-hidden className="absolute top-[22px] left-1 size-1.5 rounded-full bg-blue-500" />}
			<Face notice={notice} />
			<div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-baseline gap-2">
					<span className={cn("min-w-0 flex-1 truncate text-[13px]", notice.read ? "text-muted-foreground" : "font-medium text-foreground")}>{headline}</span>
					<Age at={notice.at} compact className="shrink-0 text-[11px] tabular-nums text-muted-foreground group-hover:invisible group-focus-within:invisible" />
				</div>
				<p role={failed ? "alert" : undefined} className={cn("line-clamp-2 text-xs leading-relaxed", failed ? "text-red-600 dark:text-red-400" : notice.read ? "text-muted-foreground" : "text-foreground/80")}>
					{preview}
				</p>
				<div className="pointer-events-auto relative mt-1 flex empty:hidden">
					<NoticeAction notice={notice} send={send} onDone={onDone} />
				</div>
			</div>
			<Tooltip content="Clear">
				<Button
					variant="ghost"
					size="icon-compact"
					aria-label={`Clear: ${headline}`}
					disabled={!connected || ("status" in notice && notice.status.state === "updating")}
					onClick={() => send({ t: "notice", ids: [notice.id], op: "clear" })}
					className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				>
					<X />
				</Button>
			</Tooltip>
		</li>
	);
}

/** The sidebar's bell: how many notices are unread, and the list of them by source, unread first. */
export function NoticesBell({ notices }: { notices: Notice[] }) {
	const { send } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState<Source | "all">("all");
	const unread = notices.filter(notice => !notice.read);
	const shown = notices.filter(notice => filter === "all" || sourceOf(notice) === filter);
	const shownUnread = shown.filter(notice => !notice.read);
	const close = () => setOpen(false);
	const body = useRef<HTMLDivElement>(null);
	const section = (title: string, list: Notice[]) =>
		list.length > 0 && (
			<section aria-label={title}>
				<h3 className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{title}</h3>
				<ul className="flex flex-col">
					{list.map(notice => (
						<NoticeRow key={notice.id} notice={notice} send={send} onDone={close} />
					))}
				</ul>
			</section>
		);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content="Notifications" side="bottom" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon-compact"
						className="shrink-0 text-muted-foreground"
						aria-label={unread.length === 0 ? "Notifications" : `Notifications, ${unread.length} unread`}
						data-state={open ? "open" : "closed"}
						active={open}
					>
						<Bell />
						{unread.length > 0 && (
							<span aria-hidden className="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-semibold tabular-nums text-white ring-2 ring-sidebar">
								{unread.length > 9 ? "9+" : unread.length}
							</span>
						)}
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent
				align="start"
				className="flex max-h-[min(560px,80vh)] w-[380px] flex-col p-0"
				// The list takes focus, so no header tooltip opens and the arrow keys scroll it.
				onOpenAutoFocus={event => {
					event.preventDefault();
					body.current?.focus();
				}}
			>
				<header className="flex items-center gap-2 border-b px-3 pt-3 pb-2">
					<h2 className="flex-1 text-sm font-semibold">Notifications</h2>
					<Tooltip content="Mark all as read">
						<Button variant="ghost" size="icon-compact" aria-label="Mark all as read" disabled={!connected || shownUnread.length === 0} onClick={() => send({ t: "notice", ids: shownUnread.map(({ id }) => id), op: "read" })}>
							<CheckCheck />
						</Button>
					</Tooltip>
				</header>
				<div role="group" aria-label="Show" className="flex gap-1 border-b px-2 py-1.5">
					{FILTERS.map(([id, label]) => {
						const count = unread.filter(notice => id === "all" || sourceOf(notice) === id).length;
						return (
							<button
								key={id}
								type="button"
								aria-pressed={filter === id}
								onClick={() => setFilter(id)}
								className={cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs transition-colors", filter === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
							>
								{label}
								{count > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>}
							</button>
						);
					})}
				</div>
				<div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto p-1 outline-none">
					{shown.length === 0 ? (
						<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
							<span className="flex size-9 items-center justify-center rounded-full bg-muted">
								<Bell aria-hidden className="size-4 text-muted-foreground" />
							</span>
							<p className="text-sm font-medium">You're all caught up</p>
							<p className="text-xs text-muted-foreground">Pull requests that wait on you, Slack messages for you, and updates land here.</p>
						</div>
					) : (
						<>
							{section("New", shownUnread)}
							{section("Earlier", shown.filter(notice => notice.read))}
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
