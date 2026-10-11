import { ChevronsUpDown, ExternalLink, Paperclip, RefreshCw } from "lucide-react";
import { useEffect, useReducer } from "react";
import type { MailAttachment, MailBody, MailMessage, MailThread } from "../../../src/shared/gmail";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { foldMessages, foldsAfter, linkParts, NO_FOLDS, personLabel, recipientsLine } from "../../inbox-model";
import { formatBytes, mailTime } from "../../labels";
import { readMailThread, useMailThread } from "../../reads";
import { hashForInbox } from "../../routing";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { DetailPage } from "../list-page";
import { LoadNote } from "../sheet-details";
import { MailFrame } from "./mail-frame";

/** When mail arrived, as Gmail's list dates it, with the full date and time on hover. */
export function MailTime({ at }: { at: number }) {
	const date = new Date(at);
	return (
		<time dateTime={date.toISOString()} title={date.toLocaleString()} className="shrink-0 text-xs tabular-nums text-muted-foreground">
			{mailTime(at)}
		</time>
	);
}

/** Who sent `message`, `me` for the inbox's own `address`. */
const senderLabel = (message: MailMessage, address: string | null): string => personLabel(message.from, address) || "(no sender)";

function Attachments({ attachments }: { attachments: MailAttachment[] }) {
	return (
		<ul aria-label="Attachments" className="flex flex-wrap gap-2">
			{attachments.map((attachment, index) => (
				// Two files of one message may share a name.
				<li key={index} title={attachment.type} className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
					<Paperclip aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="truncate">{attachment.name}</span>
					<span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(attachment.size)}</span>
				</li>
			))}
		</ul>
	);
}

function Body({ body, title }: { body: MailBody; title: string }) {
	switch (body.kind) {
		case "html":
			return (
				// Mail is written for white paper, so it stays white in the dark theme too.
				<div className="overflow-hidden rounded-md bg-white">
					<MailFrame html={body.html} title={title} />
				</div>
			);
		case "text":
			return (
				<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
					{linkParts(body.text).map((part, index) =>
						part.kind === "link" ? (
							<a key={index} href={part.href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
								{part.href}
							</a>
						) : (
							part.text
						),
					)}
				</p>
			);
		case "empty":
			return <p className="text-sm text-muted-foreground">This message has no text to show here; open it in Gmail.</p>;
		default: {
			const never: never = body;
			return never;
		}
	}
}

const ROW = "flex w-full min-w-0 items-center gap-3 rounded-md px-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

interface MessageProps {
	message: MailMessage;
	/** The inbox's own address, which reads as `me`. */
	address: string | null;
	onToggle: () => void;
}

/** A message in full: its sender and date over whom it went to, its attachments, and its body; the header closes it. */
function OpenMessage({ message, address, onToggle }: MessageProps) {
	const sender = senderLabel(message, address);
	const recipients = recipientsLine(message, address);
	return (
		<article className="space-y-3 pb-3">
			<button type="button" aria-expanded onClick={onToggle} className={cn(ROW, "h-10 text-sm")}>
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					<span className="truncate font-semibold">{sender}</span>
					{message.from.name && <span className="truncate text-xs text-muted-foreground">{message.from.address}</span>}
				</span>
				<MailTime at={message.at} />
			</button>
			<div className="space-y-3 px-3">
				{recipients && <p className="truncate text-xs text-muted-foreground">{recipients}</p>}
				{message.attachments.length > 0 && <Attachments attachments={message.attachments} />}
				<Body body={message.body} title={`Message from ${sender}`} />
			</div>
		</article>
	);
}

/** A message on one line, its sender, snippet, and date, which opens it. */
function ClosedMessage({ message, address, onToggle }: MessageProps) {
	return (
		<button type="button" aria-expanded={false} onClick={onToggle} className={cn(ROW, "h-10 text-sm", message.unread && "font-semibold")}>
			<span className="w-44 shrink-0 truncate">{senderLabel(message, address)}</span>
			<span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{message.snippet}</span>
			<MailTime at={message.at} />
		</button>
	);
}

interface ThreadDetailProps {
	id: string;
	/** The conversation as the inbox lists it, which titles the page until its read arrives; `null` when the list does not hold it. */
	listed: MailThread | null;
	/** The conversations listed before and after it, which ↑ and ↓ open. */
	previous: MailThread | undefined;
	next: MailThread | undefined;
	/** The inbox's own address, which reads as `me`. */
	address: string | null;
}

/**
 * A conversation in full, as Gmail shows one: the last message and the unread ones open, earlier ones on one line, and a
 * long run of those folded into one row. ↓ and ↑ open the next and previous conversation of the list, which it reads
 * ahead, Esc goes back to the list, and O opens the conversation in Gmail. Reading it here does not mark it read, since
 * the dashboard reads Gmail read only.
 */
export function ThreadDetail({ id, listed, previous, next, address }: ThreadDetailProps) {
	const { read, error, loading } = useMailThread(id, listed?.at ?? null);
	const thread = read?.data ?? null;
	const messages = thread?.messages ?? [];
	const [folds, fold] = useReducer(foldsAfter, NO_FOLDS);
	const url = thread?.url ?? listed?.url ?? null;

	useEffect(() => {
		if (previous) readMailThread(previous.id);
		if (next) readMailThread(next.id);
	}, [previous, next]);

	const step = (neighbour: MailThread | undefined): boolean => {
		if (!listed) return false;
		if (neighbour) location.hash = hashForInbox(neighbour.id);
		return true;
	};
	useShortcuts({
		inboxNext: () => step(next),
		inboxPrevious: () => step(previous),
		inboxBack: () => {
			location.hash = hashForInbox(null);
		},
		inboxOnGmail: () => {
			if (!url) return false;
			window.open(url, "_blank", "noopener,noreferrer");
		},
	});

	const rows = foldMessages(messages, folds);
	const subject = thread?.subject ?? listed?.subject ?? null;
	const last = messages.at(-1);
	const count = thread ? messages.length : listed?.count;
	const meta = [last ? senderLabel(last, address) : listed?.from, count === undefined ? null : `${count} ${count === 1 ? "message" : "messages"}`].filter(Boolean).join(" · ");

	return (
		<DetailPage
			title={subject === null ? "Conversation" : subject || "(no subject)"}
			meta={meta || "Gmail conversation"}
			backHref={hashForInbox(null)}
			backLabel="Back to inbox"
			className="max-w-4xl space-y-3"
			actions={
				<>
					{rows.some(row => row.kind !== "open") && (
						<Button variant="ghost" size="compact" leadingIcon={ChevronsUpDown} onClick={() => fold({ kind: "expand-all", messages })}>
							Expand all
						</Button>
					)}
					<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={loading} onClick={() => readMailThread(id, true)}>
						{loading && thread ? "Refreshing…" : "Refresh"}
					</Button>
					<Tooltip content="Open the conversation in Gmail" shortcut={shortcutLabels("inboxOnGmail")} side="bottom">
						<Button variant="ghost" size="compact" leadingIcon={ExternalLink} disabled={!url} render={url ? <a href={url} target="_blank" rel="noreferrer" /> : undefined}>
							Open in Gmail
						</Button>
					</Tooltip>
				</>
			}
		>
			{!thread && <LoadNote loading="Asking Gmail for the conversation…" error={error && `Cannot load the conversation: ${error}`} />}
			{thread && error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the conversation: {error}</p>}
			{thread && messages.length === 0 && <p className="text-sm text-muted-foreground">This conversation holds only drafts.</p>}
			{rows.length > 0 && (
				<ol aria-label="Messages" className="divide-y rounded-md border p-1">
					{rows.map(row => {
						switch (row.kind) {
							case "open":
							case "closed": {
								const Message = row.kind === "open" ? OpenMessage : ClosedMessage;
								return (
									<li key={row.message.id}>
										<Message message={row.message} address={address} onToggle={() => fold({ kind: "toggle", id: row.message.id })} />
									</li>
								);
							}
							case "stack":
								return (
									<li key={`stack-${row.ids[0]}`}>
										<button type="button" onClick={() => fold({ kind: "unstack", ids: row.ids })} className={cn(ROW, "h-9 text-xs text-muted-foreground")}>
											<span className="rounded-full border px-2 py-0.5 tabular-nums">{row.ids.length}</span>
											older messages
										</button>
									</li>
								);
							default: {
								const never: never = row;
								return never;
							}
						}
					})}
				</ol>
			)}
		</DetailPage>
	);
}
