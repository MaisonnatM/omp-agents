/** The Inbox's open conversation: its action bar, subject, messages folded as Gmail folds them, and the reply. */
import { ChevronsUpDown, ExternalLink, Paperclip, RefreshCw, Reply, ReplyAll, Trash2 } from "lucide-react";
import { useMemo, useReducer, useState } from "react";
import type { MailAttachment, MailMessage, MailPerson, MailReply, MailThread } from "../../../src/shared/gmail";
import { recipientsOf } from "../../../src/shared/gmail";
import { MailEditor } from "./mail-editor";
import { errorText } from "../../../src/json";
import { putJson } from "../../api";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { colorIndex, foldMessages, foldsAfter, initialOf, linkParts, NO_FOLDS, participants, personLabel, recipientsLine } from "../../inbox-model";
import { formatBytes, mailTime } from "../../labels";
import { gmailStore, mailThreadStore, useMailThread } from "../../reads";
import { hashForInbox } from "../../routing";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, type BarAction } from "../list-split";
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

function Body({ message, thread, title }: { message: MailMessage; thread: string; title: string }) {
	const { body } = message;
	switch (body.kind) {
		case "html":
			return (
				// Mail is written for white paper, so it stays white in the dark theme too.
				<div className="overflow-hidden rounded-md bg-white">
					<MailFrame thread={thread} id={message.id} title={title} />
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

/** Avatar backgrounds that white letters read on in both themes; {@link colorIndex} picks one per sender. */
const AVATAR_COLORS = [
	"bg-rose-600",
	"bg-orange-600",
	"bg-amber-600",
	"bg-lime-700",
	"bg-emerald-600",
	"bg-teal-600",
	"bg-cyan-700",
	"bg-sky-600",
	"bg-blue-600",
	"bg-indigo-600",
	"bg-violet-600",
	"bg-fuchsia-600",
	"bg-pink-600",
] as const;

/** A round badge with the initial of `person`, in the colour their address always takes. */
function Avatar({ person }: { person: MailPerson }) {
	return (
		<span aria-hidden className={cn("flex size-8 shrink-0 select-none items-center justify-center rounded-full text-sm font-medium text-white", AVATAR_COLORS[colorIndex(person.address, AVATAR_COLORS.length)])}>
			{initialOf(person)}
		</span>
	);
}

const ROW = "flex w-full min-w-0 gap-3 rounded-md px-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

interface MessageProps {
	message: MailMessage;
	/** The conversation's id, which with the message's own addresses its HTML. */
	thread: string;
	/** The inbox's own address, which reads as `me`. */
	address: string | null;
	onToggle: () => void;
}

/** A message in full: the sender's avatar, name, and address, the date, and whom it went to, then its attachments and body under the name; the header closes it. */
function OpenMessage({ message, thread, address, onToggle }: MessageProps) {
	const sender = senderLabel(message, address);
	const recipients = recipientsLine(message, address);
	return (
		<article className="space-y-3 py-4">
			<button type="button" aria-expanded onClick={onToggle} className={cn(ROW, "items-start py-1.5")}>
				<Avatar person={message.from} />
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2 text-sm">
						<span className="truncate font-semibold">{sender}</span>
						{message.from.name && <span className="min-w-0 truncate text-xs text-muted-foreground">{message.from.address}</span>}
						<span className="ml-auto">
							<MailTime at={message.at} />
						</span>
					</span>
					{recipients && <span className="block truncate text-xs text-muted-foreground">{recipients}</span>}
				</span>
			</button>
			<div className="space-y-3 pr-2 pl-13">
				{message.attachments.length > 0 && <Attachments attachments={message.attachments} />}
				<Body message={message} thread={thread} title={`Message from ${sender}`} />
			</div>
		</article>
	);
}

/** A message on one line, the sender's avatar and name, its snippet, and its date, which opens it. */
function ClosedMessage({ message, address, onToggle }: MessageProps) {
	return (
		<button type="button" aria-expanded={false} onClick={onToggle} className={cn(ROW, "items-center py-3 text-sm")}>
			<Avatar person={message.from} />
			<span className={cn("max-w-[40%] shrink-0 truncate", message.unread && "font-semibold")}>{senderLabel(message, address)}</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground">{message.snippet}</span>
			<MailTime at={message.at} />
		</button>
	);
}

/** The bottom of a conversation with no reply open: a line that starts a reply to the last sender, and Reply all. */
function ReplyPrompt({ to, disabled, onReply }: { to: string; disabled: boolean; onReply: (all: boolean) => void }) {
	return (
		<div className="flex items-center gap-2 rounded-xl border border-border bg-background p-1.5 shadow-sm">
			<button
				type="button"
				disabled={disabled}
				onClick={() => onReply(false)}
				className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
			>
				<Reply className="size-4 shrink-0" />
				<span className="truncate">Reply to {to}…</span>
			</button>
			<Button type="button" variant="ghost" size="compact" leadingIcon={ReplyAll} disabled={disabled} onClick={() => onReply(true)}>
				Reply all
			</Button>
		</div>
	);
}

interface ThreadDetailProps {
	id: string;
	/** The conversation as the inbox lists it, which titles the panel until its read arrives; `null` when the list does not hold it. */
	listed: MailThread | null;
	/** Where it sits in the list, `null` when the list does not hold it. */
	position: { at: number; of: number } | null;
	/** Opens the previous listed conversation, `undefined` at the top. */
	onPrevious?: () => void;
	/** Opens the next listed conversation, `undefined` at the bottom. */
	onNext?: () => void;
	/** The inbox's own address, which reads as `me`. */
	address: string | null;
	/** Called once the conversation moved to Trash, to open another. */
	onTrashed: () => void;
}

/**
 * A conversation as a page of its own, as Front shows one: a bar with where it sits in the list and its actions, its
 * subject and who wrote in it, then its messages, folded as Gmail folds them: the last message and the unread ones open,
 * earlier ones on one line, and a long run of those folded into one row. A reply is written at the bottom of the page,
 * under the messages, and can grow to fill it. Delete moves the conversation to Gmail's Trash. Reading it here does not
 * mark it read.
 */
export function ThreadDetail({ id, listed, position, onPrevious, onNext, address, onTrashed }: ThreadDetailProps) {
	const { read, error, refreshing } = useMailThread(id, listed?.at ?? null);
	const thread = read?.data ?? null;
	const messages = thread?.messages ?? [];
	const [folds, fold] = useReducer(foldsAfter, NO_FOLDS);
	const url = thread?.url ?? listed?.url ?? null;
	const [composing, setComposing] = useState<{ all: boolean } | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [trashing, setTrashing] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const last = messages.at(-1);
	const canReply = last !== undefined && !trashing;
	const all = composing?.all ?? false;
	const recipients = useMemo(() => ({ ...(last ? recipientsOf(last, address ?? "", all) : { to: [], cc: [] }), bcc: [] }), [last, address, all]);

	const compose = (all: boolean): boolean => {
		if (!canReply) return false;
		setComposing({ all });
		return true;
	};
	const trash = async (): Promise<void> => {
		setTrashing(true);
		setActionError(null);
		try {
			await putJson<object>("/api/gmail/trash", { thread: id });
			onTrashed();
			void gmailStore.refresh(null, { fresh: true });
		} catch (err) {
			setActionError(`Cannot delete the conversation: ${errorText(err)}`);
			setTrashing(false);
		}
	};
	useShortcuts({
		inboxReply: () => compose(false),
		inboxReplyAll: () => compose(true),
		inboxTrash: () => {
			if (trashing) return false;
			void trash();
		},
	});

	const rows = foldMessages(messages, folds);
	const subject = thread?.subject ?? listed?.subject ?? null;
	const count = thread ? messages.length : listed?.count;
	const people = thread ? participants(messages, address) : listed ? [listed.from] : [];
	const meta = [count === undefined ? "" : `${count} ${count === 1 ? "message" : "messages"}`, people.join(", ")].filter(Boolean).join(" · ");

	const expandAll = rows.some(row => row.kind !== "open");
	const previous: BarAction = { label: "Previous conversation", icon: CH_PREVIOUS, shortcut: "inboxPrevious", onClick: onPrevious };
	const next: BarAction = { label: "Next conversation", icon: CH_NEXT, shortcut: "inboxNext", onClick: onNext };
	const close: BarAction = { label: "Close", icon: CH_CLOSE, shortcut: "inboxClose", href: hashForInbox(null) };
	return (
		<section aria-label={subject || "Conversation"} className="flex h-full min-h-0 min-w-0 flex-col">
			<DetailBar
				leading={position && <span className="tabular-nums">{position.at + 1} of {position.of}</span>}
				previous={previous}
				next={next}
				close={close}
			>
				<Tooltip content="Reply" shortcut={shortcutLabels("inboxReply")} disabled={!canReply}>
					<Button variant="ghost" size="icon-compact" aria-label="Reply" disabled={!canReply} onClick={() => compose(false)}>
						<Reply />
					</Button>
				</Tooltip>
				<Tooltip content="Reply all" shortcut={shortcutLabels("inboxReplyAll")} disabled={!canReply}>
					<Button variant="ghost" size="icon-compact" aria-label="Reply all" disabled={!canReply} onClick={() => compose(true)}>
						<ReplyAll />
					</Button>
				</Tooltip>
				<Tooltip content="Delete" shortcut={shortcutLabels("inboxTrash")} disabled={trashing}>
					<Button variant="ghost" size="icon-compact" aria-label="Delete" disabled={trashing} onClick={() => void trash()}>
						<Trash2 />
					</Button>
				</Tooltip>
				{expandAll && (
					<Button variant="ghost" size="icon-compact" aria-label="Expand all" onClick={() => fold({ kind: "expand-all", messages })}>
						<ChevronsUpDown />
					</Button>
				)}
				<Tooltip content={refreshing ? "Refreshing…" : "Refresh"} disabled={refreshing}>
					<Button variant="ghost" size="icon-compact" aria-label="Refresh" disabled={refreshing} onClick={() => void mailThreadStore.refresh(id, { fresh: true })}>
						<RefreshCw className={cn(refreshing && "animate-spin")} />
					</Button>
				</Tooltip>
				<Tooltip content="Open in Gmail" shortcut={shortcutLabels("inboxOnGmail")} disabled={!url}>
					<Button variant="ghost" size="icon-compact" aria-label="Open in Gmail" disabled={!url} render={url ? <a href={url} target="_blank" rel="noreferrer" /> : undefined}>
						<ExternalLink />
					</Button>
				</Tooltip>
			</DetailBar>
			<div className={cn("min-h-0 w-full flex-1 space-y-4 overflow-y-auto px-8 py-6", expanded && composing && "hidden")}>
				{subject !== null && (
					<header className="space-y-1.5">
						<h2 className="break-words text-2xl font-semibold leading-tight tracking-tight">{subject || "(no subject)"}</h2>
						{meta && <p className="text-sm text-muted-foreground">{meta}</p>}
					</header>
				)}
				{!thread && <LoadNote loading="Asking Gmail for the conversation…" error={error && `Cannot load the conversation: ${error}`} />}
				{thread && error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the conversation: {error}</p>}
				{actionError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
				{thread && messages.length === 0 && <p className="text-sm text-muted-foreground">This conversation holds only drafts.</p>}
				{rows.length > 0 && (
					<ol aria-label="Messages" className="-mx-2">
						{rows.map(row => {
							switch (row.kind) {
								case "open":
								case "closed": {
									const Message = row.kind === "open" ? OpenMessage : ClosedMessage;
									return (
										<li key={row.message.id} className="border-t border-border first:border-t-0">
											<Message message={row.message} thread={id} address={address} onToggle={() => fold({ kind: "toggle", id: row.message.id })} />
										</li>
									);
								}
								case "stack":
									return (
										// The stack stands in for the line between the messages around it, so the one after it draws none.
										<li key={`stack-${row.ids[0]}`} className="relative flex justify-center py-3 [&+li]:border-t-0">
											<span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-border" />
											<button
												type="button"
												onClick={() => fold({ kind: "unstack", ids: row.ids })}
												className="relative rounded-full border border-border bg-background px-3 py-1 text-xs tabular-nums text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
											>
												{row.ids.length} older messages
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
			</div>
			{last && (
				<div className={cn("flex shrink-0 flex-col px-6 pb-4", expanded && composing && "min-h-0 flex-1 pt-4")}>
					{composing ? (
						<MailEditor
							draftKey={`thread.${id}`}
							toLabel={composing.all ? "Reply all" : "Reply to"}
							recipients={recipients}
							subject={null}
							expanded={expanded}
							onExpand={setExpanded}
							onSend={async draft => {
								const { subject: _, ...body } = draft;
								await putJson<object>("/api/gmail/reply", { ...body, thread: id } satisfies MailReply);
							}}
							onClose={() => {
								setComposing(null);
								setExpanded(false);
							}}
							onDone={() => {
								setComposing(null);
								setExpanded(false);
								void mailThreadStore.refresh(id, { fresh: true });
								void gmailStore.refresh(null, { fresh: true });
							}}
						/>
					) : (
						<ReplyPrompt to={senderLabel(last, address)} disabled={!canReply} onReply={compose} />
					)}
				</div>
			)}
		</section>
	);
}
