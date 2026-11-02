/** The Inbox page: everything that waits on you, grouped in two-line rows, with the open item's session conversation or notice beside the list, worked from the keyboard. */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CircleAlert, GitPullRequest, MessageSquare } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Notice } from "../../../src/shared/notices";
import type { LiveView, RosterHost } from "../../../src/shared/sessions";
import { hashForSession } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { INBOX_FILTERS, type InboxItem, type InboxNotice, inboxSections, itemCount, nextAfter, routeAfter, sectionsIn } from "../../inbox-model";
import { follow } from "../../notice-model";
import { PAGE_ICON } from "../../page-icons";
import { useShowConversation } from "../../pane-store";
import { type ModelList, UNREAD } from "../../reads";
import { hashForInbox } from "../../routing";
import { useOpenLatest } from "../../use-open-latest";
import { shortcutKeys, useShortcuts } from "../../shortcuts";
import { useAction } from "../../use-action";
import { Age } from "../age";
import type { ConversationHandle } from "../conversation";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { ShortcutChip } from "../kbd";
import { PageFrame, useReturnFocus } from "../list-page";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { NoticeAction } from "../notices";
import { ViewConversation } from "../pane";
import { StatusDot } from "../status-dot";
import { subjectOf } from "../subject";

interface InboxPageProps {
	hosts: RosterHost[];
	notices: Notice[];
	/** The ids of the pinned sessions, whose questions come first, as in the sidebar. */
	pins: string[];
	/** The item the route opens, `null` for none. */
	openKey: string | null;
	/** Whether the server has sent its session lists, so a bare route opens the first item once there is one to open. */
	ready: boolean;
	/** The model lists the server sent, by instance id, which the open session's composer offers. */
	models: ReadonlyMap<string, ModelList>;
	/** The workspaces, which the open session's composer offers as directories. */
	workspaces: Workspace[];
}

export function InboxPage({ hosts, notices, pins, openKey, ready, models, workspaces }: InboxPageProps) {
	const [filter, setFilter] = useState<(typeof INBOX_FILTERS)[number]>(INBOX_FILTERS[0]);
	const reduceMotion = useReducedMotion() ?? false;
	const pinned = useMemo<ReadonlySet<string>>(() => new Set(pins), [pins]);
	const sections = inboxSections(hosts, notices, Date.now(), pinned);
	const listed = sectionsIn(sections, filter.id);
	const shown = listed.flatMap(({ items }) => items);
	const total = itemCount(sections);
	/**
	 * Where the open item was, so the one that takes its place opens once it leaves the list, whether you marked it read,
	 * cleared it, or ended it here, or answered it in its session. Written during render, it only remembers what this render shows.
	 */
	const lastAt = useRef(0);
	/** The routed item this list has shown, so its leaving, and not a link to an item already gone, hands the route on. */
	const shownKey = useRef<string | null>(null);
	const open = nextAfter(shown, openKey, lastAt.current);
	const at = open ? shown.indexOf(open) : -1;
	if (at >= 0) lastAt.current = at;
	if (open !== null && open.key === openKey) shownKey.current = openKey;
	const handOn = routeAfter(open, openKey, shownKey.current);
	// The item that took the routed one's place becomes the route, so an item that arrives later above it cannot take it over.
	useEffect(() => {
		if (handOn !== null) location.replace(hashForInbox(handOn));
	}, [handOn]);
	useOpenLatest(hashForInbox, openKey, shown[0]?.key ?? null, ready);
	useReturnFocus(open?.key ?? null, key => key, key => document.getElementById(`inbox-${key}`)?.querySelector("a"), total);
	const go = (item: InboxItem | null | undefined): void => {
		if (item) location.hash = hashForInbox(item.key);
	};
	const close = (): void => {
		location.hash = hashForInbox();
	};
	const previous = shown[at - 1];
	const next = shown[at + 1];
	const nav: InboxNav = { at, of: shown.length, onPrevious: previous && (() => go(previous)), onNext: next && (() => go(next)), onClose: close };
	useShortcuts({
		inboxNext: () => go(next),
		inboxPrevious: () => go(previous),
		inboxClose: () => (open === null ? false : close()),
	});
	return (
		<PageFrame
			title="Inbox"
			meta={`${total} waiting on you`}
			actions={
				<div role="radiogroup" aria-label="Show" className="flex gap-1">
					{INBOX_FILTERS.map(chip => (
						<Button key={chip.id} {...activityControl("inbox.filter")} role="radio" aria-checked={filter === chip} variant={filter === chip ? "secondary" : "ghost"} size="compact" onClick={() => setFilter(chip)}>
							{chip.label}
							<span className="ml-1.5 text-muted-foreground tabular-nums">{itemCount(sectionsIn(sections, chip.id))}</span>
						</Button>
					))}
				</div>
			}
		>
			<ListSplit
				widthKey="omp-agents.inbox-list-width"
				resizeLabel="Resize the Inbox list"
				detailLabel="Open item"
				empty={
					total === 0
						? { icon: PAGE_ICON.inbox, title: "Nothing waits on you", hint: "Questions, finished turns, your pull request moves, and messages land here." }
						: shown.length === 0
							? { icon: PAGE_ICON.inbox, title: "No item open", hint: null }
							: { icon: PAGE_ICON.inbox, title: "No item open", hint: `Click one, or press ${shortcutKeys("inboxNext")} to open the first.` }
				}
				list={
					<div className="mx-auto w-full max-w-3xl px-3 py-2">
						{listed.map(({ group, items }) => (
							<section key={group} aria-label={group} className="mb-3">
								<h2 className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground">
									{group}
									<span className="tabular-nums">{items.length}</span>
								</h2>
								<ul className="space-y-0.5">
									<AnimatePresence initial={false}>
										{items.map(item => (
											<InboxRow key={item.key} item={item} open={item.key === open?.key} reduceMotion={reduceMotion} />
										))}
									</AnimatePresence>
								</ul>
							</section>
						))}
						{shown.length === 0 && total > 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No {filter.label.toLowerCase()} wait on you.</p>}
					</div>
				}
				detail={
					open === null ? null : open.kind === "notice" ? (
						<NoticeDetail key={open.key} item={open} nav={nav} />
					) : (
						// Keyed by the session, so moving between two items of one session keeps its transcript instead of loading it again.
						<SessionDetail key={`session/${open.host.instanceId}`} item={open} nav={nav} models={models} workspaces={workspaces} />
					)
				}
			/>
		</PageFrame>
	);
}

const NOTICE_MARK: Record<InboxNotice["kind"], ReactNode> = {
	"pull-request": <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
	slack: <MessageSquare aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
	stopped: <CircleAlert aria-hidden className="size-3.5 shrink-0 text-amber-600" />,
};

/** What marks an item in its row and its bar: its session's status, or its notice's kind. */
function ItemMark({ item }: { item: InboxItem }) {
	return item.kind === "notice" ? NOTICE_MARK[item.notice.kind] : <StatusDot status={item.host.status} />;
}

function InboxRow({ item, open, reduceMotion }: { item: InboxItem; open: boolean; reduceMotion: boolean }) {
	const row = useRef<HTMLLIElement>(null);
	useEffect(() => {
		if (open) row.current?.scrollIntoView({ block: "nearest" });
	}, [open]);
	return (
		<motion.li
			ref={row}
			id={`inbox-${item.key}`}
			layout={!reduceMotion}
			initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
			animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
			exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
			transition={{ ...spring.moderate, bounce: 0 }}
			className="overflow-hidden"
		>
			<a
				href={hashForInbox(item.key)}
				aria-current={open ? "page" : undefined}
				className={cn("flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", open && "bg-accent")}
			>
				<span className="flex min-w-0 items-center gap-2">
					<ItemMark item={item} />
					<span className="truncate font-medium">{item.title}</span>
					{item.place && <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{item.place}</span>}
					{item.at !== null && <Age at={item.at} compact className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground" />}
				</span>
				<span className="truncate pl-3.5 text-xs text-muted-foreground">{item.line}</span>
			</a>
		</motion.li>
	);
}

/** Where the open item sits in the shown list, and what opens its neighbours. */
interface InboxNav {
	/** The open item's index in the shown list. */
	at: number;
	/** The shown list's length. */
	of: number;
	/** Opens the item above, `undefined` at the top. */
	onPrevious: (() => void) | undefined;
	/** Opens the item below, `undefined` at the bottom. */
	onNext: (() => void) | undefined;
	/** Closes the open item, which shows the list again where the page is too narrow for both. */
	onClose: () => void;
}

/** Hides a button's key chip where the open item is too narrow for the bar's labels and their keys. */
const BAR_CHIP = "hidden @lg/inbox:inline-flex";

/** The open item's bar: its mark, title, place, and wait; previous and next with its place in the list; then its buttons. */
function InboxBar({ item, nav, children }: { item: InboxItem; nav: InboxNav; children: ReactNode }) {
	return (
		<DetailBar
			leading={
				<span className="flex min-w-0 items-center gap-2">
					<ItemMark item={item} />
					<span className="truncate text-sm font-medium text-foreground">{item.title}</span>
					{item.place && <span className="shrink-0 rounded bg-muted px-1.5 text-[11px]">{item.place}</span>}
					{item.at !== null && (
						<span className="shrink-0">
							waiting <Age at={item.at} compact className="tabular-nums" />
						</span>
					)}
				</span>
			}
			previous={{ label: "Previous item", icon: CH_PREVIOUS, shortcut: "inboxPrevious", onClick: nav.onPrevious }}
			next={{ label: "Next item", icon: CH_NEXT, shortcut: "inboxNext", onClick: nav.onNext }}
			close={{ label: "Close", icon: CH_CLOSE, shortcut: "inboxClose", onClick: nav.onClose }}
		>
			<span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">
				{nav.at + 1} of {nav.of}
			</span>
			<div className="ml-2 flex shrink-0 items-center gap-1">{children}</div>
		</DetailBar>
	);
}

interface SessionDetailProps {
	item: Extract<InboxItem, { kind: "ask" | "turn" }>;
	nav: InboxNav;
	/** The model lists the server sent, by instance id, which the session's composer offers. */
	models: ReadonlyMap<string, ModelList>;
	/** The workspaces, which the session's composer offers as directories. */
	workspaces: Workspace[];
}

/**
 * A question or a finished turn: its bar, then its session's own conversation, as its pane shows it. The conversation
 * streams while it shows, and showing it never marks the turn read: Mark read does. R, 1 to 9, and 0 work its composer.
 */
function SessionDetail({ item, nav, models, workspaces }: SessionDetailProps) {
	const { instanceId, sessionId } = item.host;
	const view = useMemo<LiveView>(() => ({ kind: "live", instanceId, agentId: null }), [instanceId]);
	useShowConversation(view);
	const conversation = useRef<ConversationHandle>(null);
	const { request, end } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const read = useAction(() => request({ t: "read", instanceId }), "Could not mark the turn read");
	// `end` toasts its own failure and resolves `false`, so this never rejects and its title never shows.
	const ending = useAction(async () => {
		await end(instanceId);
	}, "Could not end the session");
	// As the session's pane header, End shows only for a session this page may write to, not a read-only or lost one.
	const endable = subjectOf(view, item.host, null).live;
	const busy = !connected || read.pending || ending.pending;
	const openSession = (): void => {
		location.hash = hashForSession(sessionId);
	};
	useShortcuts({
		inboxOpen: () => (document.activeElement === document.body ? openSession() : false),
		inboxDone: () => (item.kind === "turn" && !busy ? read.run() : false),
		inboxEnd: () => (busy || !endable ? false : ending.run()),
		inboxReply: () => conversation.current?.focus() ?? false,
		inboxSendAll: () => conversation.current?.sendAllSuggestions() ?? false,
		// A question's card in the conversation takes 1 to 9 itself, and the composer offers no suggestions meanwhile.
		answer: key => conversation.current?.sendSuggestion(key) ?? false,
	});
	return (
		<section aria-label={item.title} className="@container/inbox flex h-full min-h-0 min-w-0 flex-col">
			<InboxBar item={item} nav={nav}>
				{item.kind === "turn" && (
					<Button variant="secondary" size="compact" loading={read.pending} disabled={busy} onClick={() => read.run()}>
						Mark read
						<ShortcutChip id="inboxDone" className={BAR_CHIP} />
					</Button>
				)}
				{endable && (
					<Button variant="ghost" size="compact" loading={ending.pending} disabled={busy} onClick={() => ending.run()}>
						{ending.pending ? "Ending…" : "End session"}
						<ShortcutChip id="inboxEnd" className={BAR_CHIP} />
					</Button>
				)}
				<Button variant="ghost" size="compact" onClick={openSession}>
					Open session
					<ShortcutChip id="inboxOpen" className={BAR_CHIP} />
				</Button>
			</InboxBar>
			<div className="relative flex min-h-0 flex-1 flex-col">
				<ViewConversation
					view={view}
					focused
					host={item.host}
					lastHost={null}
					session={null}
					models={models.get(instanceId) ?? UNREAD}
					workspaces={workspaces}
					header={false}
					autoFocus={false}
					handle={conversation}
				/>
			</div>
		</section>
	);
}

/** A notice: its bar, its text, and the same button as in the notices bell; using that button clears it, as Clear does. */
function NoticeDetail({ item, nav }: { item: Extract<InboxItem, { kind: "notice" }>; nav: InboxNav }) {
	const { send, request } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const clear = useAction(() => request({ t: "notice", ids: [item.notice.id], op: "clear" }), "Could not clear the notice");
	const { link, action } = item.presentation;
	useShortcuts({
		inboxOpen: () => (document.activeElement === document.body ? follow(link) : false),
		inboxDone: () => (connected && !clear.pending ? clear.run() : false),
	});
	return (
		<section aria-label={item.title} className="@container/inbox flex h-full min-h-0 min-w-0 flex-col">
			<InboxBar item={item} nav={nav}>
				<Button variant="secondary" size="compact" loading={clear.pending} disabled={!connected || clear.pending} onClick={() => clear.run()}>
					Clear
					<ShortcutChip id="inboxDone" className={BAR_CHIP} />
				</Button>
				<Button variant="ghost" size="compact" disabled={link === null} onClick={() => follow(link)}>
					Open
					<ShortcutChip id="inboxOpen" className={BAR_CHIP} />
				</Button>
			</InboxBar>
			<div className="px-6 py-5">
				<div className="flex max-w-prose flex-col gap-3 rounded-lg border border-border px-4 py-3">
					<p className="text-sm whitespace-pre-wrap">{item.line}</p>
					<div className="flex self-start empty:hidden">
						<NoticeAction id={item.notice.id} action={action} send={send} onDone={() => clear.run()} />
					</div>
				</div>
			</div>
		</section>
	);
}
