/** The Notifications page: pull request, Slack, provider, sign-in, calendar, stopped-session, and update notices, filtered by source, each drawn from its {@link presentNotice} projection. */
import { IconArrowLoopDownLeft, IconArrowsRepeatRightLeft, IconBell, IconBubbleText, IconCalendarClock, IconCircleX, IconCrossMedium, IconDoubleCheckmark1, IconExclamationCircle, IconEyeOpen, IconGauge, IconKey1, IconMerged, IconPlugin1, IconSparklesTwo, IconWallet1 } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { type ReactNode, useState } from "react";
import { type AccountsService, MCP_SERVICES } from "../../src/shared/accounts";
import type { PullRequestSummary } from "../../src/shared/github";
import type { YourMove } from "../../src/shared/moves";
import type { Notice } from "../../src/shared/notices";
import type { ClientMsg } from "../../src/shared/protocol";
import { Button } from "@/components/ui/button";
import { PageFrame } from "./list-page";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { type NoticeAction as Action, type NoticeFace, type NoticeSource, follow, presentNotice } from "../notice-model";
import { readPinnedSkill } from "../pinned-skill";
import { pendingOf, pullRequestStart, QUICK_ACTIONS } from "../quick-actions";
import { providerLabel, providerOrg } from "../labels";
import { Age } from "./age";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { BrandMark, type BrandLogo, GMAIL_LOGO, GOOGLE_CALENDAR_LOGO, SLACK_LOGO } from "./integrations/brand-logos";
import { OrgIcon } from "./org-icon";
import { MergePopover, useMergeTarget } from "./pull-requests/merge-popover";

type Send = (msg: ClientMsg) => void;

const TAB_LOGO = "size-3.5 shrink-0";

/** The popover's source tabs, each with the logo its notices carry. */
const FILTERS: [NoticeSource | "all", string, ReactNode][] = [
	["all", "All", null],
	["github", "GitHub", <OrgIcon key="github" org="github" className={TAB_LOGO} />],
	["slack", "Slack", <BrandMark key="slack" logo={SLACK_LOGO} className={TAB_LOGO} />],
	["providers", "Providers", <IconGauge key="providers" aria-hidden className={TAB_LOGO} />],
	["integrations", "Integrations", <IconPlugin1 key="integrations" aria-hidden className={TAB_LOGO} />],
	["calendar", "Calendar", <IconCalendarClock key="calendar" aria-hidden className={TAB_LOGO} />],
	["sessions", "Sessions", <IconExclamationCircle key="sessions" aria-hidden className={TAB_LOGO} />],
	["updates", "Updates", <IconSparklesTwo key="updates" aria-hidden className={cn(TAB_LOGO, "text-violet-600 dark:text-violet-400")} />],
];

/** Each of your moves with the icon and colours of the Pull requests page's badge for it. */
const MOVE_BADGE: Record<YourMove, { icon: IconComponent; tone: string }> = {
	review: { icon: IconEyeOpen, tone: "bg-blue-500 text-white" },
	merge: { icon: IconMerged, tone: "bg-emerald-500 text-white" },
	"fix-ci": { icon: IconCircleX, tone: "bg-red-500 text-white" },
	rebase: { icon: IconArrowsRepeatRightLeft, tone: "bg-orange-500 text-white" },
	reply: { icon: IconBubbleText, tone: "bg-amber-500 text-white" },
};

/** Each Google service's logo, which its sign-in notice shows. */
const SERVICE_LOGO: Record<AccountsService, BrandLogo> = { gmail: GMAIL_LOGO, "google-calendar": GOOGLE_CALENDAR_LOGO };

/** Where a notice came from, as a logo and a name: GitHub, Slack, the provider, the Google service, Google Calendar or this computer's calendar, omp, or omp-agents. */
function originOf(notice: Notice): { logo: ReactNode; label: string } {
	const mark = "size-3.5 shrink-0";
	const sparkles = <IconSparklesTwo className={cn(mark, "text-violet-600 dark:text-violet-400")} />;
	switch (notice.kind) {
		case "pull-request":
			return { logo: <OrgIcon org="github" className={mark} />, label: "GitHub" };
		case "slack":
			return { logo: <BrandMark logo={SLACK_LOGO} className={mark} />, label: "Slack" };
		case "plan":
		case "credits": {
			const Icon = notice.kind === "plan" ? IconGauge : IconWallet1;
			return { logo: <OrgIcon org={providerOrg(notice.provider)} className={mark} fallback={<Icon aria-hidden className={mark} />} />, label: providerLabel(notice.provider) };
		}
		case "event":
			return notice.calendar === null
				? { logo: <IconCalendarClock className={mark} />, label: "Calendar" }
				: { logo: <BrandMark logo={GOOGLE_CALENDAR_LOGO} className={mark} />, label: "Google Calendar" };
		case "omp":
		case "model":
			return { logo: sparkles, label: "omp" };
		case "dashboard":
		case "dashboard-failed":
			return { logo: sparkles, label: "omp-agents" };
		case "stopped":
			return { logo: <IconExclamationCircle className={cn(mark, "text-amber-600 dark:text-amber-400")} />, label: "omp-agents" };
		case "sign-in":
			return { logo: <BrandMark logo={SERVICE_LOGO[notice.service]} className={mark} />, label: MCP_SERVICES[notice.service].label };
		default: {
			const unhandled: never = notice;
			return unhandled;
		}
	}
}

/** A notice toast's source line: the logo and name of where it came from. */
export function NoticeOrigin({ notice }: { notice: Notice }) {
	const { logo, label } = originOf(notice);
	return (
		<>
			{logo}
			<span className="truncate">{label}</span>
		</>
	);
}
const BADGE = "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2 ring-popover";

/** A notice's picture: who it comes from with a badge for its source; an update's, a stopped session's, or a move nobody made's source tile; or a provider's or Google service's logo with a warning badge. */
function Face({ face }: { face: NoticeFace }) {
	switch (face.kind) {
		case "update":
			return (
				<span className="relative mt-0.5 flex size-8 shrink-0 rounded-lg bg-violet-500/10">
					<IconSparklesTwo className="m-auto size-4 text-violet-600 dark:text-violet-400" />
				</span>
			);
		case "event":
			return (
				<span className="relative mt-0.5 flex size-8 shrink-0 rounded-lg bg-muted">
					<IconCalendarClock className="m-auto size-4" style={{ color: face.color ?? undefined }} />
				</span>
			);
		case "stopped":
			return (
				<span className="relative mt-0.5 flex size-8 shrink-0 rounded-lg bg-amber-500/10">
					<IconExclamationCircle className="m-auto size-4 text-amber-600 dark:text-amber-400" />
				</span>
			);
		case "provider": {
			const Icon = face.window === "plan" ? IconGauge : IconWallet1;
			return (
				<span className="relative mt-0.5 flex size-8 shrink-0 rounded-lg bg-muted">
					<OrgIcon org={providerOrg(face.provider)} className="m-auto size-4" fallback={<Icon aria-hidden className="m-auto size-4 text-muted-foreground" />} />
					<span className={cn(BADGE, "bg-red-500 text-white")}>
						<Icon aria-hidden className="size-2.5 icon-shapes:stroke-[2.5]" />
					</span>
				</span>
			);
		}
		case "sign-in":
			return (
				<span className="relative mt-0.5 flex size-8 shrink-0 rounded-lg bg-muted">
					<BrandMark logo={SERVICE_LOGO[face.service]} className="m-auto size-4" />
					<span className={cn(BADGE, "bg-red-500 text-white")}>
						<IconKey1 className="size-2.5 icon-shapes:stroke-[2.5]" />
					</span>
				</span>
			);
		case "move": {
			const { icon: Icon, tone } = MOVE_BADGE[face.move];
			if (!face.person) {
				return (
					<span className={cn("relative mt-0.5 flex size-8 shrink-0 rounded-full", tone)}>
						<Icon aria-hidden className="m-auto size-4" />
					</span>
				);
			}
			return (
				<Avatar person={face.person}>
					<span className={cn(BADGE, tone)}>
						<Icon aria-hidden className="size-2.5 icon-shapes:stroke-[2.5]" />
					</span>
				</Avatar>
			);
		}
		case "slack":
			return (
				<Avatar person={face.person}>
					<span className={cn(BADGE, "bg-popover")}>
						<BrandMark logo={SLACK_LOGO} className="size-3" />
					</span>
				</Avatar>
			);
	}
}

function Avatar({ person, children }: { person: { name: string; avatarUrl: string | null }; children: ReactNode }) {
	return (
		<span className="relative mt-0.5 flex size-8 shrink-0 rounded-full bg-muted">
			{person.avatarUrl ? (
				<img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full rounded-full object-cover" />
			) : (
				<span aria-hidden className="m-auto text-xs font-semibold uppercase text-muted-foreground">
					{person.name[0]}
				</span>
			)}
			{children}
		</span>
	);
}

/** **Merge**: merges after the same confirmation as a pull request's details, and marks the notice read once the server took it. */
function NoticeMerge({ pr, onMerged }: { pr: PullRequestSummary; onMerged: () => void }) {
	const { connected } = useDashboardStatus();
	const [open, setOpen] = useState(false);
	const target = useMergeTarget(pr, open);
	return (
		<MergePopover pr={pr} target={target.data} error={target.error} onQueued={onMerged} open={open} onOpenChange={setOpen} align="start">
			{({ pending }) => (
				<Button variant="secondary" size="compact" leadingIcon={IconMerged} loading={pending} disabled={!connected}>
					Merge
				</Button>
			)}
		</MergePopover>
	);
}

/** A notice's button: **Update**, the quick action that makes a pull request's move, **Merge**, or **Continue all**; `onDone` runs once it acted. */
function NoticeAction({ id, action, send, onDone }: { id: string; action: Action; send: Send; onDone: () => void }) {
	const { start } = useDashboardActions();
	const { connected, starts } = useDashboardStatus();
	const read = () => send({ t: "notice", ids: [id], op: "read" });
	switch (action.kind) {
		case "none":
			return null;
		case "update":
			return (
				<Button
					{...activityControl("notices.update")}
					variant="secondary"
					size="compact"
					loading={action.updating}
					disabled={!connected || !action.ready}
					onClick={() => send({ t: "notice", ids: [id], op: "update" })}
				>
					{action.updating ? "Updating" : "Update"}
				</Button>
			);
		case "merge":
			return (
				<NoticeMerge
					pr={action.pr}
					onMerged={() => {
						read();
						onDone();
					}}
				/>
			);
		case "quick": {
			const { pr, cwd } = action;
			const pending = pendingOf(starts.quick, { kind: "pull-request", pr }) !== null;
			return (
				<Button
					variant="secondary"
					size="compact"
					disabled={!connected || pending}
					onClick={() => {
						start(pullRequestStart(pr, action.action, cwd, readPinnedSkill()));
						read();
						onDone();
					}}
				>
					{QUICK_ACTIONS[action.action].label}
				</Button>
			);
		}
		case "continue-all": {
			const resuming = starts.resumeAll?.phase === "starting";
			return (
				<Button
					variant="secondary"
					size="compact"
					leadingIcon={IconArrowLoopDownLeft}
					loading={resuming}
					disabled={!connected || resuming}
					onClick={() => {
						start({ kind: "resume-all", sessionIds: action.sessionIds });
						read();
						onDone();
					}}
				>
					Continue all
				</Button>
			);
		}
		default: {
			const unhandled: never = action;
			return unhandled;
		}
	}
}

function NoticeRow({ notice, send }: { notice: Notice; send: Send }) {
	const { connected } = useDashboardStatus();
	const { headline, preview, failed, busy, link, face, action } = presentNotice(notice, Date.now());
	const read = () => {
		if (!notice.read) send({ t: "notice", ids: [notice.id], op: "read" });
	};
	const label = `${notice.read ? "" : "Unread: "}${headline}`;
	// After its quick action, a pull request's notice opens the pull request, where the session it started shows.
	const done = () => {
		if (action.kind === "quick") follow(link);
	};
	return (
		<li className="group relative flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/70 has-[>a:focus-visible]:bg-muted/70">
			{link ? (
				<a
					{...activityControl("notices.item")}
					href={link.href}
					target={link.external ? "_blank" : undefined}
					rel={link.external ? "noreferrer" : undefined}
					aria-label={label}
					className="absolute inset-0 rounded-lg focus-visible:outline-none"
					onClick={read}
				/>
			) : (
				<button {...activityControl("notices.item")} type="button" aria-label={notice.read ? headline : `Mark read: ${headline}`} className="absolute inset-0 rounded-lg focus-visible:outline-none" onClick={read} />
			)}
			{!notice.read && <span aria-hidden className="absolute top-[22px] left-1 size-1.5 rounded-full bg-blue-500" />}
			<Face face={face} />
			<div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-baseline gap-2">
					<span className={cn("min-w-0 flex-1 truncate text-[13px]", notice.read ? "text-muted-foreground" : "font-medium text-foreground")}>{headline}</span>
					<Age at={notice.at} compact className="shrink-0 text-[11px] tabular-nums text-muted-foreground group-hover:invisible group-focus-within:invisible" />
				</div>
				<p role={failed ? "alert" : undefined} className={cn("line-clamp-2 text-xs leading-relaxed", failed ? "text-red-600 dark:text-red-400" : notice.read ? "text-muted-foreground" : "text-foreground/80")}>
					{preview}
				</p>
				<div className="pointer-events-auto relative mt-1 flex empty:hidden">
					<NoticeAction id={notice.id} action={action} send={send} onDone={done} />
				</div>
			</div>
			<Tooltip content="Clear">
				<Button
					{...activityControl("notices.clear")}
					variant="ghost"
					size="icon-compact"
					aria-label={`Clear: ${headline}`}
					disabled={!connected || busy}
					onClick={() => send({ t: "notice", ids: [notice.id], op: "clear" })}
					className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				>
					<IconCrossMedium />
				</Button>
			</Tooltip>
		</li>
	);
}

/** The Notifications page: how many notices are unread, and the list of them by source, unread first. */
export function NotificationsPage({ notices }: { notices: Notice[] }) {
	const { send } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [filter, setFilter] = useState<NoticeSource | "all">("all");
	const now = Date.now();
	const unread = notices.filter(notice => !notice.read);
	const shown = notices.filter(notice => filter === "all" || presentNotice(notice, now).source === filter);
	const shownUnread = shown.filter(notice => !notice.read);
	const section = (title: string, list: Notice[]) =>
		list.length > 0 && (
			<section aria-label={title}>
				<h3 className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">{title}</h3>
				<ul className="flex flex-col">
					{list.map(notice => (
						<NoticeRow key={notice.id} notice={notice} send={send} />
					))}
				</ul>
			</section>
		);
	return (
		<PageFrame
			title="Notifications"
			meta={unread.length === 0 ? "All read" : `${unread.length} unread`}
			actions={
				<Button {...activityControl("notices.read-all")} variant="ghost" size="compact" leadingIcon={IconDoubleCheckmark1} disabled={!connected || shownUnread.length === 0} onClick={() => send({ t: "notice", ids: shownUnread.map(({ id }) => id), op: "read" })}>
					Mark all as read
				</Button>
			}
		>
			<div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-8">
				<div role="group" aria-label="Show" className="sticky top-0 z-10 flex shrink-0 gap-1 overflow-x-auto scrollbar-hide bg-background py-2">
					{FILTERS.map(([id, label, logo]) => {
						const count = unread.filter(notice => id === "all" || presentNotice(notice, now).source === id).length;
						return (
							<button
								{...activityControl("notices.filter")}
								key={id}
								type="button"
								aria-pressed={filter === id}
								onClick={event => {
									setFilter(id);
									event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
								}}
								className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors", filter === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
							>
								{logo}
								{label}
								{count > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>}
							</button>
						);
					})}
				</div>
				{shown.length === 0 ? (
					<div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
						<span className="flex size-9 items-center justify-center rounded-full bg-muted">
							<IconBell className="size-4 text-muted-foreground" />
						</span>
						<p className="text-sm font-medium">You're all caught up</p>
						<p className="max-w-sm text-xs text-muted-foreground">Pull requests that wait on you, Slack messages for you, providers that stop serving, events about to start, and updates land here.</p>
					</div>
				) : (
					<>
						{section("New", shownUnread)}
						{section("Earlier", shown.filter(notice => notice.read))}
					</>
				)}
			</div>
		</PageFrame>
	);
}
