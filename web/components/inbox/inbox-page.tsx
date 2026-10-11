import type { McpIntegration } from "../../../src/shared/accounts";
import type { MailThread } from "../../../src/shared/gmail";
import { cn } from "@/lib/utils";
import { mailTime } from "../../labels";
import { gmailStore, useGmailInbox } from "../../reads";
import { IntegrationList } from "../integrations/integration-row";
import { McpIntegrationRow } from "../integrations/mcp-integration";
import { ListPage, PageFrame } from "../list-page";

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

/** Your Gmail inbox's latest conversations, newest first, each opening in Gmail. */
export function InboxPage() {
	const { inbox } = useGmailInbox();
	const read = inbox.read?.data;
	const unread = read?.threads.filter(thread => thread.unread).length ?? 0;
	return (
		<ListPage
			title={TITLE}
			meta={read ? `${read.address} · ${unread} unread` : META}
			noun="your inbox"
			loading="Asking Gmail for your inbox…"
			poll={inbox}
			onRefresh={() => void gmailStore.refresh(null, { fresh: true })}
			notice={null}
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

/** The Inbox page while omp cannot read Gmail: Gmail's integration row, to connect from here as from Settings › Integrations. */
export function InboxDisconnected({ gmail }: { gmail: McpIntegration }) {
	return (
		<PageFrame title={TITLE} meta={META}>
			<div className="mx-auto w-full max-w-3xl px-6 py-6">
				<IntegrationList label="Gmail connection">
					<McpIntegrationRow integration={gmail} />
				</IntegrationList>
			</div>
		</PageFrame>
	);
}
