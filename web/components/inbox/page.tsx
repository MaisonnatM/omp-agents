/** The Inbox page: everything that waits on you, grouped in two-line rows, with the open item's session conversation or notice beside the list, worked from the keyboard. */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CircleAlert, GitPullRequest, LoaderCircle, MessageSquare } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../../../src/json";
import type { Notice } from "../../../src/shared/notices";
import type { LiveView, RosterHost } from "../../../src/shared/sessions";
import { hashForSession } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { INBOX_FILTERS, type InboxItem, type InboxNotice, inboxSections, itemCount, nextAfter, sectionsIn } from "../../inbox-model";
import { follow } from "../../notice-model";
import { PAGE_ICON } from "../../page-icons";
import { useShowConversation } from "../../pane-store";
import { type ModelList, UNREAD } from "../../reads";
import { hashForInbox } from "../../routing";
import { useShortcuts } from "../../shortcuts";
import { Age } from "../age";
import { blockedShortcut } from "../composer";
import { allPrompts } from "../composer-suggestions";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { ShortcutChip } from "../kbd";
import { PageFrame } from "../list-page";
import { CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { NoticeAction } from "../notices";
import { ViewConversation } from "../pane";
import type { PromptEditorHandle } from "../prompt-editor";
import { StatusDot } from "../status-dot";
import { deliveryOf, subjectOf } from "../subject";
import { toasts } from "../toaster";

interface InboxPageProps {
	hosts: RosterHost[];
	notices: Notice[];
	/** The item the route opens, `null` for the first. */
	openKey: string | null;
	/** The model lists the server sent, by instance id, which the open session's composer offers. */
	models: ReadonlyMap<string, ModelList>;
	/** The workspaces, which the open session's composer offers as directories. */
	workspaces: Workspace[];
}

export function InboxPage({ hosts, notices, openKey, models, workspaces }: InboxPageProps) {
	const [filter, setFilter] = useState<(typeof INBOX_FILTERS)[number]>(INBOX_FILTERS[0]);
	const reduceMotion = useReducedMotion() ?? false;
	const sections = inboxSections(hosts, notices, Date.now());
	const listed = sectionsIn(sections, filter.id);
	const shown = listed.flatMap(({ items }) => items);
	const total = itemCount(sections);
	/**
	 * Where the open item was, so the one that takes its place opens once it leaves the list without you acting on it
	 * here, such as a question answered in its session. Written during render, it only remembers what this render shows.
	 */
	const lastAt = useRef(0);
	const open = openKey === null ? (shown[0] ?? null) : nextAfter(shown, openKey, lastAt.current);
	const at = open ? shown.indexOf(open) : -1;
	if (at >= 0) lastAt.current = at;
	const go = (item: InboxItem | null | undefined): void => {
		if (item) location.hash = hashForInbox(item.key);
	};
	/** After the server confirms what you did to the open item, the next one opens, though the item stays listed until the server's next push drops it. */
	const advance = (): void => {
		if (open) go(nextAfter(shown.filter(item => item !== open), open.key, at));
	};
	const previous = shown[at - 1];
	const next = shown[at + 1];
	useShortcuts({
		inboxNext: () => go(next),
		inboxPrevious: () => go(previous),
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
				empty={{ icon: PAGE_ICON.inbox, title: "Nothing waits on you", hint: "Questions, finished turns, your pull request moves, and messages land here." }}
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
					open === null ? null : (
						<InboxDetail
							// Keyed by the session, so moving between two items of one session keeps its transcript instead of loading it again.
							key={open.kind === "notice" ? open.key : `session/${open.host.instanceId}`}
							item={open}
							position={{ at, of: shown.length }}
							onPrevious={previous && (() => go(previous))}
							onNext={next && (() => go(next))}
							models={models}
							workspaces={workspaces}
							onDone={advance}
						/>
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

interface InboxDetailProps {
	item: InboxItem;
	/** The open item's index in the shown list, and the list's length. */
	position: { at: number; of: number };
	/** Opens the item above, `undefined` at the top. */
	onPrevious: (() => void) | undefined;
	/** Opens the item below, `undefined` at the bottom. */
	onNext: (() => void) | undefined;
	models: ReadonlyMap<string, ModelList>;
	workspaces: Workspace[];
	/** Opens the next item, once the server confirmed what you did to this one. */
	onDone: () => void;
}

/**
 * The open item: its triage bar, then its session's own conversation, as its pane shows it, or a notice's text and action.
 * The conversation streams while it shows, and showing it never marks its turn read: D does.
 */
function InboxDetail({ item, position, onPrevious, onNext, models, workspaces, onDone }: InboxDetailProps) {
	const instanceId = item.kind === "notice" ? null : item.host.instanceId;
	const view = useMemo<LiveView | null>(() => (instanceId === null ? null : { kind: "live", instanceId, agentId: null }), [instanceId]);
	useShowConversation(view);
	const editorRef = useRef<PromptEditorHandle>(null);
	return (
		<section aria-label={item.title} className="@container/inbox flex h-full min-h-0 min-w-0 flex-col">
			<InboxTriage key={item.key} item={item} view={view} editorRef={editorRef} position={position} onPrevious={onPrevious} onNext={onNext} onDone={onDone} />
			{view && item.kind !== "notice" && (
				<div className="relative flex min-h-0 flex-1 flex-col">
					<ViewConversation
						view={view}
						focused
						host={item.host}
						lastHost={null}
						session={null}
						models={models.get(view.instanceId) ?? UNREAD}
						workspaces={workspaces}
						header={false}
						autoFocus={false}
						editorRef={editorRef}
					/>
				</div>
			)}
		</section>
	);
}

/** What you do to the open item; it has at most one in flight. */
type InboxAction = "send" | "done" | "end";

/** Resolves `true` once the server confirms `work`, or toasts `failureTitle` with why it failed and resolves `false`. */
async function settle(work: Promise<void>, failureTitle: string): Promise<boolean> {
	try {
		await work;
		return true;
	} catch (error) {
		toasts.add({ title: failureTitle, description: errorText(error) });
		return false;
	}
}

interface InboxTriageProps {
	item: InboxItem;
	/** The item's session, `null` for a notice. */
	view: LiveView | null;
	/** The session composer's editor, which R focuses. */
	editorRef: RefObject<PromptEditorHandle | null>;
	position: InboxDetailProps["position"];
	onPrevious: InboxDetailProps["onPrevious"];
	onNext: InboxDetailProps["onNext"];
	onDone: () => void;
}

/** Hides a button's key chip where the open item is too narrow for the bar's labels and their keys. */
const BAR_CHIP = "hidden @lg/inbox:inline-flex";

/**
 * The open item's bar and keys: its mark, title, place, and wait; previous and next; and Mark read or Clear, End session,
 * and Open, each pending until the server answers. A notice's text and action show under the bar.
 */
function InboxTriage({ item, view, editorRef, position, onPrevious, onNext, onDone }: InboxTriageProps) {
	const { send, request, end } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [acting, setActing] = useState<InboxAction | null>(null);
	const latestDone = useRef(onDone);
	latestDone.current = onDone;
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	// A success keeps `acting` set: the next item replaces this one, or the server's push drops it when it was the last.
	const act = (action: InboxAction, work: () => Promise<boolean>): void => {
		if (acting !== null) return;
		setActing(action);
		void work().then(ok => {
			if (!mounted.current) return;
			if (ok) latestDone.current();
			else setActing(null);
		});
	};
	const subject = view && item.kind !== "notice" ? subjectOf(view, item.host, null) : null;
	const prompt = (text: string): void => {
		if (view && subject) act("send", () => settle(request({ t: "prompt", view, text, images: [], delivery: deliveryOf(subject) }), "Could not send the prompt"));
	};
	const done = (): void => {
		if (item.kind === "turn") act("done", () => settle(request({ t: "read", instanceId: item.host.instanceId }), "Could not mark the turn read"));
		else if (item.kind === "notice") act("done", () => settle(request({ t: "notice", ids: [item.notice.id], op: "clear" }), "Could not clear the notice"));
	};
	const endSession = (): void => {
		if (view) act("end", () => end(view.instanceId));
	};
	const openItem = (): void => {
		if (item.kind === "notice") follow(item.presentation.link);
		else location.hash = hashForSession(item.host.sessionId);
	};
	// The same prompts, in the same order, as the composer's numbered list.
	const suggestions = item.kind === "turn" && subject?.writable ? item.turn.suggestions.filter(text => blockedShortcut(text, subject.shell) === null) : [];
	useShortcuts({
		inboxOpen: () => (document.activeElement === document.body ? openItem() : false),
		inboxDone: () => (item.kind !== "ask" ? done() : false),
		inboxEnd: () => (view ? endSession() : false),
		inboxReply: () => {
			const editor = editorRef.current;
			if (!editor?.editable()) return false;
			editor.focus();
		},
		inboxSendAll: () => (suggestions.length > 0 ? prompt(allPrompts(suggestions)) : false),
		// A question's card in the conversation takes 1 to 9 itself; a finished turn's keys send its suggestions.
		answer: key => (key < suggestions.length ? prompt(suggestions[key]!) : false),
	});
	const busy = !connected || acting !== null;
	return (
		<>
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
				previous={{ label: "Previous item", icon: CH_PREVIOUS, shortcut: "inboxPrevious", onClick: onPrevious }}
				next={{ label: "Next item", icon: CH_NEXT, shortcut: "inboxNext", onClick: onNext }}
			>
				<span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">
					{position.at + 1} of {position.of}
				</span>
				<div className="ml-2 flex shrink-0 items-center gap-1">
					{acting === "send" && (
						<span role="status" aria-busy className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
							<LoaderCircle aria-hidden className="size-3.5 animate-spin" />
							Sending…
						</span>
					)}
					{item.kind !== "ask" && (
						<Button variant="secondary" size="compact" loading={acting === "done"} disabled={busy} onClick={done}>
							{item.kind === "turn" ? "Mark read" : "Clear"}
							<ShortcutChip id="inboxDone" className={BAR_CHIP} />
						</Button>
					)}
					{view && (
						<Button variant="ghost" size="compact" loading={acting === "end"} disabled={busy} onClick={endSession}>
							{acting === "end" ? "Ending…" : "End session"}
							<ShortcutChip id="inboxEnd" className={BAR_CHIP} />
						</Button>
					)}
					<Button variant="ghost" size="compact" disabled={item.kind === "notice" && item.presentation.link === null} onClick={openItem}>
						{item.kind === "notice" ? "Open" : "Open session"}
						<ShortcutChip id="inboxOpen" className={BAR_CHIP} />
					</Button>
				</div>
			</DetailBar>
			{item.kind === "notice" && (
				<div className="px-6 py-5">
					<div className="flex max-w-prose flex-col gap-3 rounded-lg border border-border px-4 py-3">
						<p className="text-sm whitespace-pre-wrap">{item.line}</p>
						<div className="flex self-start empty:hidden">
							<NoticeAction id={item.notice.id} action={item.presentation.action} send={send} onDone={done} />
						</div>
					</div>
				</div>
			)}
		</>
	);
}
