/** The Inbox page: everything that waits on you, grouped in two-line rows, with the open item's reply, question, or notice beside the list, worked from the keyboard. */
import { CircleAlert, GitPullRequest, MessageSquare } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { Notice } from "../../../src/shared/notices";
import type { RosterHost } from "../../../src/shared/sessions";
import { hashForSession } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { FINISHED_TURN } from "../../attention";
import { INBOX_FILTERS, type InboxItem, type InboxNotice, inboxSections, itemCount, nextAfter, sectionsIn } from "../../inbox-model";
import { follow } from "../../notice-model";
import { PAGE_ICON } from "../../page-icons";
import { hashForInbox } from "../../routing";
import { useShortcuts } from "../../shortcuts";
import { Age } from "../age";
import { allPrompts } from "../composer-suggestions";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { ShortcutChip } from "../kbd";
import { PageFrame } from "../list-page";
import { ListSplit } from "../list-split";
import { MessageMarkdown } from "../message-markdown";
import { NoticeAction } from "../notices";
import { StatusDot } from "../status-dot";
import { UserRequestCard } from "../user-request";

interface InboxPageProps {
	hosts: RosterHost[];
	notices: Notice[];
	/** The item the route opens, `null` for the first. */
	openKey: string | null;
}

export function InboxPage({ hosts, notices, openKey }: InboxPageProps) {
	const [filter, setFilter] = useState<(typeof INBOX_FILTERS)[number]>(INBOX_FILTERS[0]);
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
	/** After you act on the open item, the next one opens at once, though the item stays listed until the server's next push drops it. */
	const advance = (): void => {
		if (open) go(nextAfter(shown.filter(item => item !== open), open.key, at));
	};
	useShortcuts({
		inboxNext: () => go(shown[at + 1]),
		inboxPrevious: () => go(shown[at - 1]),
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
									{items.map(item => (
										<InboxRow key={item.key} item={item} open={item.key === open?.key} />
									))}
								</ul>
							</section>
						))}
						{shown.length === 0 && total > 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No {filter.label.toLowerCase()} wait on you.</p>}
					</div>
				}
				detail={open === null ? null : <InboxDetail key={open.key} item={open} onDone={advance} />}
			/>
		</PageFrame>
	);
}

const NOTICE_MARK: Record<InboxNotice["kind"], ReactNode> = {
	"pull-request": <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
	slack: <MessageSquare aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
	stopped: <CircleAlert aria-hidden className="size-3.5 shrink-0 text-amber-600" />,
};

function InboxRow({ item, open }: { item: InboxItem; open: boolean }) {
	return (
		<li id={`inbox-${item.key}`}>
			<a
				href={hashForInbox(item.key)}
				aria-current={open ? "page" : undefined}
				className={cn("flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring", open && "bg-accent")}
			>
				<span className="flex min-w-0 items-center gap-2">
					{item.kind === "notice" ? NOTICE_MARK[item.notice.kind] : <StatusDot status={item.host.status} />}
					<span className="truncate font-medium">{item.title}</span>
					{item.place && <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{item.place}</span>}
					{item.at !== null && <Age at={item.at} compact className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground" />}
				</span>
				<span className="truncate pl-3.5 text-xs text-muted-foreground">{item.line}</span>
			</a>
		</li>
	);
}

/**
 * The open item: its group, place, and wait, its title, what it says, and the moves it offers, which it sends itself.
 * `onDone` opens the next item once you acted on this one.
 */
function InboxDetail({ item, onDone }: { item: InboxItem; onDone: () => void }) {
	const { send, request, end } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const reply = useRef<HTMLTextAreaElement>(null);
	/** The item's session, `null` for a notice. */
	const host = item.kind === "notice" ? null : item.host;
	const prompt = (text: string): void => {
		if (!host || !text.trim()) return;
		void request({ t: "prompt", view: { kind: "live", instanceId: host.instanceId, agentId: null }, text, images: [], delivery: "steer" });
		onDone();
	};
	const done = (): void => {
		if (item.kind === "turn") send({ t: "read", instanceId: item.host.instanceId });
		else if (item.kind === "notice") send({ t: "notice", ids: [item.notice.id], op: "clear" });
		else return;
		onDone();
	};
	const openItem = (): void => {
		if (item.kind === "notice") follow(item.presentation.link);
		else location.hash = hashForSession(item.host.sessionId);
	};
	const endSession = (): void => {
		if (!host) return;
		end(host.instanceId);
		onDone();
	};
	const suggestions = item.kind === "turn" ? item.turn.suggestions : [];
	useShortcuts({
		inboxOpen: () => (document.activeElement === document.body ? openItem() : false),
		inboxDone: () => (item.kind !== "ask" ? done() : false),
		inboxEnd: () => (host ? endSession() : false),
		inboxReply: () => (host ? reply.current?.focus() : false),
		inboxSendAll: () => (suggestions.length > 0 ? prompt(allPrompts(suggestions)) : false),
		// A question's card takes 1 to 9 itself; a finished turn's keys send its suggestions.
		answer: key => (key < suggestions.length ? prompt(suggestions[key]!) : false),
	});
	return (
		<section aria-label={item.title} className="flex flex-col gap-4 px-6 py-5">
			<header className="flex flex-col gap-1">
				<p className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>{item.group}</span>
					{item.place && <span className="rounded bg-muted px-1.5 text-[11px]">{item.place}</span>}
					{item.at !== null && (
						<span>
							waiting <Age at={item.at} compact className="tabular-nums" />
						</span>
					)}
				</p>
				<h2 className="text-xl font-semibold">{item.title}</h2>
			</header>
			<InboxBody item={item} onPrompt={prompt} onDone={onDone} onNoticeDone={done} />
			{host && <ReplyBox ref={reply} disabled={!connected} onSend={prompt} />}
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" size="compact" onClick={openItem}>
					{item.kind === "notice" ? "Open" : "Open session"}
					<ShortcutChip id="inboxOpen" />
				</Button>
				{host && (
					<Button variant="ghost" size="compact" disabled={!connected} onClick={endSession}>
						End session
						<ShortcutChip id="inboxEnd" />
					</Button>
				)}
				{item.kind !== "ask" && (
					<Button variant="ghost" size="compact" disabled={!connected} onClick={done}>
						{item.kind === "turn" ? "Mark read" : "Clear"}
						<ShortcutChip id="inboxDone" />
					</Button>
				)}
			</div>
			<p className="text-xs text-muted-foreground">J and K move, 1 to 9 pick, 0 sends every suggestion, R replies, D marks done.</p>
		</section>
	);
}

interface InboxBodyProps {
	item: InboxItem;
	onPrompt: (text: string) => void;
	onDone: () => void;
	/** Clears the notice, once its action ran, and opens the next item. */
	onNoticeDone: () => void;
}

/** What the open item says: a question's card, a turn's reply and suggested prompts, or a notice's text and action. */
function InboxBody({ item, onPrompt, onDone, onNoticeDone }: InboxBodyProps) {
	const { send, request } = useDashboardActions();
	switch (item.kind) {
		case "ask": {
			const { host, request: asked } = item;
			if (!asked) return <p className="text-sm text-muted-foreground">It waits for your input in its terminal; open the session to answer.</p>;
			return (
				<UserRequestCard
					key={asked.id}
					request={asked}
					queued={host.requests.length - 1}
					onAnswer={async answer => {
						await request({ t: "answer", instanceId: host.instanceId, requestId: asked.id, answer });
						onDone();
					}}
					shortcuts
				/>
			);
		}
		case "turn":
			return (
				<>
					{item.turn.body ? <MessageMarkdown text={item.turn.body} /> : <p className="text-sm text-muted-foreground">{FINISHED_TURN}</p>}
					{item.turn.suggestions.length > 0 && (
						<ol aria-label="Suggested prompts" className="flex flex-col gap-1">
							{item.turn.suggestions.map((text, index) => (
								<li key={text}>
									<button type="button" {...activityControl("inbox.suggestion")} onClick={() => onPrompt(text)} className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
										<span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
										{text}
									</button>
								</li>
							))}
						</ol>
					)}
				</>
			);
		case "notice":
			return (
				<>
					<p className="text-sm whitespace-pre-wrap">{item.line}</p>
					<div className="flex self-start empty:hidden">
						<NoticeAction id={item.notice.id} action={item.presentation.action} send={send} onDone={onNoticeDone} />
					</div>
				</>
			);
		default: {
			const unhandled: never = item;
			return unhandled;
		}
	}
}

/** The reply field: Enter sends to the open item's session, Shift+Enter breaks the line, and Escape leaves the field. */
function ReplyBox({ ref, disabled, onSend }: { ref: React.Ref<HTMLTextAreaElement>; disabled: boolean; onSend: (text: string) => void }) {
	return (
		<textarea
			ref={ref}
			aria-label="Reply to this session"
			placeholder="Reply to this session…"
			rows={2}
			disabled={disabled}
			onKeyDown={event => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Escape") event.currentTarget.blur();
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					onSend(event.currentTarget.value);
					event.currentTarget.value = "";
				}
			}}
			className="min-h-16 w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
	);
}
