import { Mail } from "lucide-react";
import { callable } from "../../../src/shared/accounts";
import type { MailThread } from "../../../src/shared/gmail";
import { cn } from "@/lib/utils";
import { readTime } from "../../labels";
import { gmailStore, mailThreadStore, useGmailInbox } from "../../reads";
import { hashForInbox } from "../../routing";
import { shortcutKeys, useShortcuts } from "../../shortcuts";
import { DisconnectedPage } from "../integrations/disconnected-page";
import { focusRow, PageFrame, PolledContent, RefreshButton, stepRows, useReturnFocus } from "../list-page";
import { ListSplit } from "../list-split";
import { MailTime, ThreadDetail } from "./thread-view";

const TITLE = "Inbox";
const META = "Your Gmail inbox";

const rowId = (threadId: string): string => `inbox-row-${threadId}`;
const rowOf = (thread: MailThread): HTMLElement | null => document.getElementById(rowId(thread.id));

/**
 * A conversation as Superhuman lists one, on three lines: who sent its last message, how many it holds, and when it
 * arrived; its subject; and its snippet. Its link opens it beside the list.
 */
function ThreadRow({ thread, open }: { thread: MailThread; open: boolean }) {
	return (
		<li id={rowId(thread.id)}>
			<a
				href={hashForInbox(thread.id)}
				aria-current={open ? "true" : undefined}
				className={cn(
					"relative block min-w-0 space-y-0.5 rounded-md px-3 py-2.5 text-sm outline-none",
					// The open row looks selected, so its focus needs no ring of its own.
					open
						? "bg-accent before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
						: "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
				)}
			>
				<span className="flex items-center gap-2">
					<span aria-hidden className={cn("size-2 shrink-0 rounded-full", thread.unread && "bg-blue-500")} />
					{thread.unread && <span className="sr-only">Unread:</span>}
					<span className={cn("min-w-0 flex-1 truncate", thread.unread ? "font-semibold" : "text-foreground/75")}>{thread.from}</span>
					{thread.count > 1 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{thread.count}</span>}
					<MailTime at={thread.at} />
				</span>
				<span className={cn("block truncate pl-4", thread.unread && "font-semibold")}>{thread.subject || "(no subject)"}</span>
				<span className="block truncate pl-4 text-muted-foreground">{thread.snippet}</span>
			</a>
		</li>
	);
}

/**
 * Your Gmail inbox's latest conversations, newest first, beside the conversation `target` names, or Gmail's integration
 * row while omp cannot read it. With no conversation open, ↓ and ↑ focus the next and previous row; with one open, they
 * open the next and previous one and focus its row, which they read ahead. Esc closes it, and O opens the focused row in
 * Gmail, else the open conversation.
 */
export function InboxPage({ target }: { target: string | null }) {
	const { gmail, inbox, unread } = useGmailInbox();
	const read = inbox.read;
	const threads = read?.data.threads ?? [];
	const at = target === null ? -1 : threads.findIndex(thread => thread.id === target);
	// A conversation the list does not hold, opened from its address, has its Gmail link only in its own read.
	const openRead = mailThreadStore.use(target);
	const openUrl = threads[at]?.url ?? openRead.read?.data.url ?? null;
	useReturnFocus(target, id => id, id => document.getElementById(rowId(id))?.querySelector<HTMLElement>("a"), read);

	const open = (thread: MailThread): void => {
		location.hash = hashForInbox(thread.id);
		const row = rowOf(thread);
		if (row) focusRow(row);
	};
	/** Opens the neighbour of the open conversation, or with none open, or one the list does not hold, moves the focus. */
	const step = (by: 1 | -1): boolean => {
		if (at < 0) return stepRows(threads, rowOf, by);
		const neighbour = threads[at + by];
		if (neighbour) open(neighbour);
		return true;
	};
	useShortcuts({
		inboxNext: () => step(1),
		inboxPrevious: () => step(-1),
		inboxClose: () => {
			if (target === null) return false;
			location.hash = hashForInbox(null);
		},
		inboxOnGmail: () => {
			const url = threads.find(thread => rowOf(thread)?.contains(document.activeElement))?.url ?? openUrl;
			if (!url) return false;
			window.open(url, "_blank", "noopener,noreferrer");
		},
	});

	if (gmail && !callable(gmail.connection)) return <DisconnectedPage title={TITLE} meta={META} integration={gmail} />;

	return (
		<PageFrame
			title={TITLE}
			meta={read ? `${read.data.address} · ${unread} unread · updated ${readTime(read.at)}` : META}
			actions={<RefreshButton refreshing={inbox.refreshing} onRefresh={() => void gmailStore.refresh(null, { fresh: true })} />}
		>
			<ListSplit
				widthKey="omp-agents.inbox-list-width"
				resizeLabel="Resize the conversation list"
				detailLabel="Open conversation"
				empty={{ icon: Mail, title: "No conversation open", hint: `Click one, or focus one with ${shortcutKeys("inboxNext")} and press Enter.` }}
				list={
					<div className="space-y-2 p-2">
						<PolledContent noun="your inbox" loading="Asking Gmail for your inbox…" poll={inbox}>
							{answer =>
								answer.threads.length === 0 ? (
									<p className="px-3 text-sm text-muted-foreground">Your inbox is empty.</p>
								) : (
									<ul aria-label="Conversations" className="space-y-0.5">
										{answer.threads.map(thread => (
											<ThreadRow key={thread.id} thread={thread} open={thread.id === target} />
										))}
									</ul>
								)
							}
						</PolledContent>
					</div>
				}
				detail={
					target === null ? null : (
						<ThreadDetail
							key={target}
							id={target}
							listed={threads[at] ?? null}
							previous={at > 0 ? threads[at - 1] : undefined}
							next={at >= 0 ? threads[at + 1] : undefined}
							address={read?.data.address ?? null}
						/>
					)
				}
			/>
		</PageFrame>
	);
}
