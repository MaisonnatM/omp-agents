import { callable } from "../../../src/shared/accounts";
import type { MailThread } from "../../../src/shared/gmail";
import { cn } from "@/lib/utils";
import { mailTime } from "../../labels";
import { gmailStore, useGmailInbox } from "../../reads";
import { DisconnectedPage } from "../integrations/disconnected-page";
import { ListPage } from "../list-page";

const TITLE = "Inbox";
const META = "Your Gmail inbox";

/** A conversation as Gmail's list shows it, which opens in Gmail. */
function ThreadRow({ thread }: { thread: MailThread }) {
	return (
		<li className="rounded-md hover:bg-muted has-[:focus-visible]:bg-muted">
			<a
				href={thread.url}
				target="_blank"
				rel="noreferrer"
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
				<time dateTime={new Date(thread.at).toISOString()} title={new Date(thread.at).toLocaleString()} className="shrink-0 text-xs tabular-nums text-muted-foreground">
					{mailTime(thread.at)}
				</time>
			</a>
		</li>
	);
}

/** Your Gmail inbox's latest conversations, newest first, each opening in Gmail, or Gmail's integration row while omp cannot read it. */
export function InboxPage() {
	const { gmail, inbox, unread } = useGmailInbox();
	if (gmail && !callable(gmail.connection)) return <DisconnectedPage title={TITLE} meta={META} integration={gmail} />;
	const read = inbox.read?.data;
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
			{({ threads }) =>
				threads.length === 0 ? (
					<p className="px-3 text-sm text-muted-foreground">Your inbox is empty.</p>
				) : (
					<ul aria-label="Conversations">
						{threads.map(thread => (
							<ThreadRow key={thread.id} thread={thread} />
						))}
					</ul>
				)
			}
		</ListPage>
	);
}
