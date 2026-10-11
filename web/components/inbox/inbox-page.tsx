import { useEffect, useRef } from "react";
import { callable } from "../../../src/shared/accounts";
import type { MailThread } from "../../../src/shared/gmail";
import { cn } from "@/lib/utils";
import { gmailStore, useGmailInbox } from "../../reads";
import { hashForInbox } from "../../routing";
import { useShortcuts } from "../../shortcuts";
import { DisconnectedPage } from "../integrations/disconnected-page";
import { ListPage } from "../list-page";
import { MailTime, ThreadDetail } from "./thread-view";

const TITLE = "Inbox";
const META = "Your Gmail inbox";

const rowId = (threadId: string): string => `inbox-row-${threadId}`;

/** A conversation as Gmail's list shows it, which opens it in full. */
function ThreadRow({ thread }: { thread: MailThread }) {
	return (
		<li id={rowId(thread.id)} className="rounded-md hover:bg-muted has-[:focus-visible]:bg-muted">
			<a
				href={hashForInbox(thread.id)}
				className={cn(
					"flex h-10 min-w-0 items-center gap-2.5 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
					thread.unread && "font-semibold",
				)}
			>
				<span aria-hidden className={cn("size-2 shrink-0 rounded-full", thread.unread && "bg-blue-500")} />
				{thread.unread && <span className="sr-only">Unread:</span>}
				<span className="flex w-48 shrink-0 items-baseline gap-1.5">
					<span className="truncate">{thread.from}</span>
					{thread.count > 1 && <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{thread.count}</span>}
				</span>
				<span className="min-w-0 flex-1 truncate">
					{thread.subject || "(no subject)"}
					{thread.snippet && <span className="font-normal text-muted-foreground"> — {thread.snippet}</span>}
				</span>
				<MailTime at={thread.at} />
			</a>
		</li>
	);
}

/** The inbox's rows, which ↓ and ↑ move between, from the first or last row while none has focus; O opens the focused one in Gmail. */
function ThreadList({ threads }: { threads: MailThread[] }) {
	const focused = (): number => threads.findIndex(thread => document.getElementById(rowId(thread.id))?.contains(document.activeElement) ?? false);
	const step = (by: 1 | -1): boolean => {
		const at = focused();
		const next = at >= 0 ? threads[at + by] : threads[by === 1 ? 0 : threads.length - 1];
		const row = next && document.getElementById(rowId(next.id));
		if (!row) return at >= 0;
		row.querySelector("a")?.focus({ preventScroll: true });
		row.scrollIntoView({ block: "nearest" });
		return true;
	};
	useShortcuts({
		inboxNext: () => step(1),
		inboxPrevious: () => step(-1),
		inboxOnGmail: () => {
			const thread = threads[focused()];
			if (!thread) return false;
			window.open(thread.url, "_blank", "noopener,noreferrer");
		},
	});
	if (threads.length === 0) return <p className="px-3 text-sm text-muted-foreground">Your inbox is empty.</p>;
	return (
		<ul aria-label="Conversations">
			{threads.map(thread => (
				<ThreadRow key={thread.id} thread={thread} />
			))}
		</ul>
	);
}

/**
 * Your Gmail inbox's latest conversations, newest first, or the conversation `target` names in full; or Gmail's
 * integration row while omp cannot read it.
 */
export function InboxPage({ target }: { target: string | null }) {
	const { gmail, inbox, unread } = useGmailInbox();
	const read = inbox.read?.data;
	const returnTo = useRef<string | null>(null);
	useEffect(() => {
		if (target !== null) returnTo.current = target;
	}, [target]);
	// Back from a conversation, focus returns to its row: the rows mount only after a read.
	useEffect(() => {
		if (target !== null || returnTo.current === null) return;
		const row = document.getElementById(rowId(returnTo.current))?.querySelector("a");
		if (!row) return;
		row.focus();
		returnTo.current = null;
	}, [target, inbox.read]);

	if (gmail && !callable(gmail.connection)) return <DisconnectedPage title={TITLE} meta={META} integration={gmail} />;

	if (target !== null) {
		const threads = read?.threads ?? [];
		const at = threads.findIndex(thread => thread.id === target);
		return (
			<ThreadDetail
				key={target}
				id={target}
				listed={threads[at] ?? null}
				previous={at > 0 ? threads[at - 1] : undefined}
				next={at >= 0 ? threads[at + 1] : undefined}
				address={read?.address ?? null}
			/>
		);
	}

	return (
		<ListPage
			title={TITLE}
			meta={read ? `${read.address} · ${unread} unread` : META}
			noun="your inbox"
			loading="Asking Gmail for your inbox…"
			poll={inbox}
			onRefresh={() => void gmailStore.refresh(null, { fresh: true })}
			className="max-w-none px-4 pt-3"
		>
			{({ threads }) => <ThreadList threads={threads} />}
		</ListPage>
	);
}
