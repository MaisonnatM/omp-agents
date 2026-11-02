/** The Inbox page: everything that waits on you, grouped in two-line rows, with the open item's reply, question, or notice beside the list, worked from the keyboard. */
import { CircleAlert, GitPullRequest, MessageSquare } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { Notice } from "../../../src/shared/notices";
import type { RosterHost } from "../../../src/shared/sessions";
import { hashForSession } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { INBOX_FILTERS, INBOX_GROUPS, type InboxFilter, type InboxItem, groupOf, inboxItems, nextAfter } from "../../inbox-model";
import { folderName, hostLabel } from "../../labels";
import { follow, presentNotice } from "../../notice-model";
import { PAGE_ICON } from "../../page-icons";
import { hashForInbox } from "../../routing";
import { useShortcuts } from "../../shortcuts";
import { Age } from "../age";
import { chosenText } from "../composer-suggestions";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { ShortcutChip } from "../kbd";
import { PageFrame } from "../list-page";
import { ListSplit } from "../list-split";
import { MessageMarkdown } from "../message-markdown";
import { StatusDot } from "../status-dot";
import { UserRequestCard } from "../user-request";

interface InboxPageProps {
	hosts: RosterHost[];
	notices: Notice[];
	/** The item the route opens, `null` for the first. */
	openKey: string | null;
}

export function InboxPage({ hosts, notices, openKey }: InboxPageProps) {
	const { send, request, start, end } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [filter, setFilter] = useState<InboxFilter>("all");
	const reply = useRef<HTMLTextAreaElement>(null);
	const items = inboxItems(hosts, notices);
	const groups: readonly string[] = INBOX_FILTERS.find(({ id }) => id === filter)!.groups;
	const shown = items.filter(item => groups.includes(groupOf(item)));
	/** Where the open item was, so the one that takes its place opens once it leaves the list. */
	const lastAt = useRef(0);
	const open = openKey === null ? (shown[0] ?? null) : nextAfter(shown, openKey, lastAt.current);
	const at = open ? shown.indexOf(open) : -1;
	if (at >= 0) lastAt.current = at;
	const go = (item: InboxItem | null | undefined): void => {
		if (item) location.hash = hashForInbox(item.key);
	};
	/** After you act on the open item, the next one opens, so you work down the list without picking. */
	const advance = (): void => go(shown[at + 1] ?? shown[at - 1]);
	/** The open item's session, `null` for a notice. */
	const openHost = open && open.kind !== "notice" ? open.host : null;
	const prompt = (host: RosterHost, text: string): void => {
		if (!text.trim()) return;
		void request({ t: "prompt", view: { kind: "live", instanceId: host.instanceId, agentId: null }, text, images: [], delivery: "steer" });
		advance();
	};
	const done = (item: InboxItem): void => {
		if (item.kind === "turn") send({ t: "read", instanceId: item.host.instanceId });
		else if (item.kind === "notice") send({ t: "notice", ids: [item.notice.id], op: "clear" });
		else return;
		advance();
	};
	const openItem = (item: InboxItem): void => {
		if (item.kind === "notice") follow(presentNotice(item.notice, Date.now()).link);
		else location.hash = hashForSession(item.host.sessionId);
	};
	const endOpen = (): void => {
		if (!openHost) return;
		end(openHost.instanceId);
		advance();
	};
	const suggestions = open?.kind === "turn" ? open.turn.suggestions : [];
	useShortcuts({
		inboxNext: () => go(shown[at + 1]),
		inboxPrevious: () => go(shown[at - 1]),
		// Enter on a focused button or link presses it; only with nothing focused does it open the item.
		inboxOpen: () => (open && document.activeElement === document.body ? openItem(open) : false),
		inboxDone: () => (open && open.kind !== "ask" ? done(open) : false),
		inboxEnd: () => (openHost ? endOpen() : false),
		inboxReply: () => (openHost ? reply.current?.focus() : false),
		inboxSendAll: () => (open?.kind === "turn" && suggestions.length > 0 ? prompt(open.host, chosenText(suggestions, new Set(suggestions), null)) : false),
		// A question's card takes 1 to 9 itself; a finished turn's keys send its suggestions.
		answer: key => (open?.kind === "turn" && key < suggestions.length ? prompt(open.host, suggestions[key]!) : false),
	});
	const counts = Object.fromEntries(INBOX_FILTERS.map(({ id, groups }) => [id, items.filter(item => (groups as readonly string[]).includes(groupOf(item))).length]));
	return (
		<PageFrame
			title="Inbox"
			meta={`${items.length} waiting on you`}
			actions={
				<div role="radiogroup" aria-label="Show" className="flex gap-1">
					{INBOX_FILTERS.map(({ id, label }) => (
						<Button key={id} {...activityControl("inbox.filter")} role="radio" aria-checked={filter === id} variant={filter === id ? "secondary" : "ghost"} size="compact" onClick={() => setFilter(id)}>
							{label}
							<span className="ml-1.5 text-muted-foreground tabular-nums">{counts[id]}</span>
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
						{INBOX_GROUPS.map(group => {
							const rows = shown.filter(item => groupOf(item) === group);
							if (rows.length === 0) return null;
							return (
								<section key={group} aria-label={group} className="mb-3">
									<h2 className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground">
										{group}
										<span className="tabular-nums">{rows.length}</span>
									</h2>
									<ul className="space-y-0.5">
										{rows.map(item => (
											<InboxRow key={item.key} item={item} open={item.key === open?.key} />
										))}
									</ul>
								</section>
							);
						})}
						{shown.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">{items.length === 0 ? "Nothing waits on you." : "Nothing here waits on you."}</p>}
					</div>
				}
				detail={
					open === null ? null : (
						<section key={open.key} aria-label={rowText(open).title} className="flex flex-col gap-4 px-6 py-5">
							<InboxDetail item={open} onPrompt={text => openHost && prompt(openHost, text)} onAnswered={advance} onContinue={sessionIds => { start({ kind: "resume-all", sessionIds }); done(open); }} />
							{openHost && <ReplyBox ref={reply} key={open.key} disabled={!connected} onSend={text => prompt(openHost, text)} />}
							<div className="flex flex-wrap gap-2">
								<Button variant="secondary" size="compact" onClick={() => openItem(open)}>
									{open.kind === "notice" ? "Open" : "Open session"}
									<ShortcutChip id="inboxOpen" />
								</Button>
								{openHost && (
									<Button variant="ghost" size="compact" disabled={!connected} onClick={endOpen}>
										End session
										<ShortcutChip id="inboxEnd" />
									</Button>
								)}
								{open.kind !== "ask" && (
									<Button variant="ghost" size="compact" disabled={!connected} onClick={() => done(open)}>
										{open.kind === "turn" ? "Mark read" : "Clear"}
										<ShortcutChip id="inboxDone" />
									</Button>
								)}
							</div>
							<p className="text-xs text-muted-foreground">J and K move, 1 to 9 pick, 0 sends every suggestion, R replies, D marks done.</p>
						</section>
					)
				}
			/>
		</PageFrame>
	);
}

/** What an item's row says: its title, the place it belongs to, and its second line. */
function rowText(item: InboxItem): { title: string; place: string | null; line: string } {
	switch (item.kind) {
		case "ask":
			return { title: hostLabel(item.host), place: folderName(item.host.cwdDisplay) ?? null, line: item.request?.title ?? "Waits for your input." };
		case "turn": {
			const [first] = item.turn.suggestions;
			return { title: hostLabel(item.host), place: folderName(item.host.cwdDisplay) ?? null, line: first ? `↳ ${first}` : (item.turn.reply ?? "Finished its turn.") };
		}
		case "notice": {
			const { headline, preview } = presentNotice(item.notice, Date.now());
			const { notice } = item;
			const place = notice.kind === "pull-request" ? notice.pr.repo : notice.kind === "slack" ? (notice.type === "mention" ? `#${notice.channel}` : "Slack") : null;
			return { title: headline, place, line: preview };
		}
	}
}

const NOTICE_MARK: Record<Extract<InboxItem, { kind: "notice" }>["notice"]["kind"], ReactNode> = {
	"pull-request": <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
	slack: <MessageSquare aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
	stopped: <CircleAlert aria-hidden className="size-3.5 shrink-0 text-amber-600" />,
};

function InboxRow({ item, open }: { item: InboxItem; open: boolean }) {
	const { title, place, line } = rowText(item);
	return (
		<li id={`inbox-${item.key}`}>
			<a
				href={hashForInbox(item.key)}
				aria-current={open ? "page" : undefined}
				className={cn("flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring", open && "bg-accent")}
			>
				<span className="flex min-w-0 items-center gap-2">
					{item.kind === "notice" ? NOTICE_MARK[item.notice.kind] : <StatusDot status={item.host.status} />}
					<span className="truncate font-medium">{title}</span>
					{place && <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{place}</span>}
					{item.at !== null && <Age at={item.at} compact className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground" />}
				</span>
				<span className="truncate pl-3.5 text-xs text-muted-foreground">{line}</span>
			</a>
		</li>
	);
}

interface InboxDetailProps {
	item: InboxItem;
	onPrompt: (text: string) => void;
	onAnswered: () => void;
	onContinue: (sessionIds: string[]) => void;
}

/** The open item: its kind, place, and wait, its title, then what it says and the moves it offers. */
function InboxDetail({ item, onPrompt, onAnswered, onContinue }: InboxDetailProps) {
	const { request } = useDashboardActions();
	const { title, place } = rowText(item);
	const head = (
		<header className="flex flex-col gap-1">
			<p className="flex items-center gap-2 text-xs text-muted-foreground">
				<span>{groupOf(item)}</span>
				{place && <span className="rounded bg-muted px-1.5 text-[11px]">{place}</span>}
				{item.at !== null && (
					<span>
						waiting <Age at={item.at} compact className="tabular-nums" />
					</span>
				)}
			</p>
			<h2 className="text-xl font-semibold">{title}</h2>
		</header>
	);
	switch (item.kind) {
		case "ask":
			return (
				<>
					{head}
					{item.request ? (
						<UserRequestCard
							key={item.request.id}
							request={item.request}
							queued={item.host.requests.length - 1}
							onAnswer={async answer => {
								await request({ t: "answer", instanceId: item.host.instanceId, requestId: item.request!.id, answer });
								onAnswered();
							}}
							shortcuts
						/>
					) : (
						<p className="text-sm text-muted-foreground">It waits for your input in its terminal; open the session to answer.</p>
					)}
				</>
			);
		case "turn":
			return (
				<>
					{head}
					{item.turn.body ? <MessageMarkdown text={item.turn.body} /> : <p className="text-sm text-muted-foreground">Finished its turn.</p>}
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
		case "notice": {
			const { notice } = item;
			const { preview } = presentNotice(notice, Date.now());
			return (
				<>
					{head}
					<p className="text-sm whitespace-pre-wrap">{preview}</p>
					{notice.kind === "stopped" && (
						<Button variant="secondary" size="compact" className="self-start" onClick={() => onContinue(notice.sessions.map(({ sessionId }) => sessionId))}>
							Continue all
						</Button>
					)}
				</>
			);
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
