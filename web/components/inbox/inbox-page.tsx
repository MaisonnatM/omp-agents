import { Mail, SquarePen } from "lucide-react";
import { useEffect } from "react";
import { callable } from "../../../src/shared/accounts";
import type { MailThread } from "../../../src/shared/gmail";
import { threadUrl, type MailSend } from "../../../src/shared/gmail";
import { putJson } from "../../api";
import { cn } from "@/lib/utils";
import { gmailStore, mailThreadStore, useGmailInbox } from "../../reads";
import { hashForInbox } from "../../routing";
import { shortcutKeys, shortcutLabels, useShortcuts } from "../../shortcuts";
import { DisconnectedPage } from "../integrations/disconnected-page";
import { focusRow, PolledPageFrame, PolledContent, stepRows, useReturnFocus } from "../list-page";
import { ListSplit } from "../list-split";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MailEditor } from "./mail-editor";
import { MailTime, ThreadDetail } from "./thread-view";

const TITLE = "Inbox";
const META = "Your Gmail inbox";

/** The target of `#inbox/new`, the page that writes a new mail; Gmail's thread ids are hex, so none reads as it. */
const COMPOSE = "new";

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

/** A new mail in the panel beside the list; sending it or throwing it away goes back to the inbox. */
function ComposePage({ address }: { address: string | null }) {
	const back = (): void => {
		location.hash = hashForInbox(null);
	};
	return (
		<div className="flex h-full min-h-0 flex-col p-4">
			<MailEditor
				draftKey="new"
				toLabel="To"
				recipients={NO_ONE}
				subject=""
				focusPeople
				expanded
				onSend={async draft => {
					await putJson<object>("/api/gmail/send", draft satisfies MailSend);
				}}
				onClose={back}
				onDone={() => {
					back();
					void gmailStore.refresh(null, { fresh: true });
				}}
			/>
			{address && <p className="mt-2 px-1 text-xs text-muted-foreground">From {address}</p>}
		</div>
	);
}

const NO_ONE = { to: [], cc: [], bcc: [] };

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
	const address = read?.data.address ?? null;
	const openUrl = address !== null && target !== null ? threadUrl(address, target) : null;
	useReturnFocus(target, id => id, id => document.getElementById(rowId(id))?.querySelector<HTMLElement>("a"), read);

	// Read the next and previous conversations while one is open, so ↓/↑ open them at once.
	const previous = at > 0 ? threads[at - 1] : undefined;
	const next = at >= 0 ? threads[at + 1] : undefined;
	useEffect(() => {
		if (previous) mailThreadStore.ensure(previous.id);
		if (next) mailThreadStore.ensure(next.id);
	}, [previous, next]);

	const open = (thread: MailThread): void => {
		location.hash = hashForInbox(thread.id);
		const row = rowOf(thread);
		if (row) focusRow(row);
	};
	const openBy = (by: 1 | -1): void => {
		const neighbour = at >= 0 ? threads[at + by] : threads[by === 1 ? 0 : threads.length - 1];
		if (neighbour) open(neighbour);
	};
	const step = (by: 1 | -1): boolean => {
		if (target === null) return stepRows(threads, rowOf, by);
		openBy(by);
		return true;
	};
	useShortcuts({
		inboxCompose: () => {
			if (target === COMPOSE) return false;
			location.hash = hashForInbox(COMPOSE);
		},
		inboxNext: () => step(1),
		inboxPrevious: () => step(-1),
		inboxClose: () => {
			if (target === null || target === COMPOSE) return false;
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
		<PolledPageFrame
			title={TITLE}
			meta={read ? `${read.data.address} · ${unread} unread` : META}
			poll={inbox}
			onRefresh={() => void gmailStore.refresh(null, { fresh: true })}
			actions={
				<Tooltip content="New mail" shortcut={shortcutLabels("inboxCompose")}>
					<Button variant="secondary" size="compact" leadingIcon={SquarePen} render={<a href={hashForInbox(COMPOSE)} />}>
						Compose
					</Button>
				</Tooltip>
			}
		>
			<ListSplit
				widthKey="omp-agents.inbox-list-width"
				resizeLabel="Resize the conversation list"
				detailLabel={target === COMPOSE ? "New mail" : "Open conversation"}
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
					target === null ? null : target === COMPOSE ? (
						<ComposePage address={address} />
					) : (
						<ThreadDetail
							key={target}
							id={target}
							listed={threads[at] ?? null}
							position={at >= 0 ? { at, of: threads.length } : null}
							onPrevious={previous ? () => open(previous) : undefined}
							onNext={next ? () => open(next) : undefined}
							address={address}
							onTrashed={() => {
								const after = next ?? previous;
								if (after) open(after);
								else location.hash = hashForInbox(null);
							}}
						/>
					)
				}
			/>
		</PolledPageFrame>
	);
}
