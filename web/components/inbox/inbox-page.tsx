import { Mail, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import { type AccountId, anyCallable, callable, type GoogleAccount } from "../../../src/shared/accounts";
import type { MailThread } from "../../../src/shared/gmail";
import { threadUrl, type MailSend } from "../../../src/shared/gmail";
import { putJson } from "../../api";
import { cn } from "@/lib/utils";
import { type MailDocument, useMailDraft } from "../../mail-draft";
import { gmailStore, mailThreadScope, mailThreadStore, useGmailInbox } from "../../reads";
import { hashForInbox, type InboxRoute, routeFromHash } from "../../routing";
import { shortcutKeys, shortcutLabels, useShortcuts } from "../../shortcuts";
import { useOpenLatest } from "../../use-open-latest";
import { DisconnectedPage } from "../integrations/disconnected-page";
import { focusRow, PolledPageFrame, PolledContent, stepRows, useReturnFocus } from "../list-page";
import { ListSplit } from "../list-split";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { MailEditor } from "./mail-editor";
import { MailTime, ThreadDetail } from "./thread-view";

const TITLE = "Inbox";
const META = "Your Gmail inboxes";

const rowId = (thread: Pick<MailThread, "account" | "id">): string => `inbox-row-${thread.account}-${thread.id}`;
const rowOf = (thread: MailThread): HTMLElement | null => document.getElementById(rowId(thread));

const accountLabel = (account: GoogleAccount): string => account.address ?? account.name;

/**
 * A conversation as Superhuman lists one, on three lines: who sent its last message, how many it holds, and when it
 * arrived; its subject; and its snippet, after the address of its inbox when the list holds several. Its link opens it
 * beside the list.
 */
function ThreadRow({ thread, open, inbox }: { thread: MailThread; open: boolean; inbox: string | null }) {
	return (
		<li id={rowId(thread)}>
			<a
				href={hashForInbox({ account: thread.account, thread: thread.id })}
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
				<span className="flex items-baseline gap-2 pl-4 text-muted-foreground">
					{inbox && (
						<span className="max-w-[45%] shrink-0 truncate rounded bg-muted px-1.5 text-xs" title={`In ${inbox}`}>
							{inbox}
						</span>
					)}
					<span className="min-w-0 flex-1 truncate">{thread.snippet}</span>
				</span>
			</a>
		</li>
	);
}

/** A new mail in the panel beside the list, from one of `accounts`, `from` first; sending it or throwing it away goes back to the inbox. */
function ComposePage({ accounts, from }: { accounts: GoogleAccount[]; from: AccountId | null }) {
	const mail = useMailDraft("new", NEW_MAIL);
	const [picked, setPicked] = useState(from);
	const sender = accounts.find(account => account.name === picked) ?? accounts[0];
	const back = (): void => {
		location.hash = hashForInbox(null);
	};
	return (
		<div className="flex h-full min-h-0 flex-col p-4">
			{mail.draft && sender && (
				<MailEditor
					draft={mail.draft}
					edit={mail}
					toLabel="To"
					withSubject
					focusPeople
					expanded
					onSend={async draft => {
						await putJson<object>("/api/gmail/send", { ...draft, account: sender.name } satisfies MailSend);
					}}
					onClose={back}
					onDone={() => {
						back();
						void gmailStore.refresh(null, { fresh: true });
					}}
				/>
			)}
			{sender &&
				(accounts.length > 1 ? (
					<div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
						From
						<Select items={accounts.map(account => ({ value: account.name, label: accountLabel(account) }))} value={sender.name} onValueChange={next => next && setPicked(next)}>
							<SelectTrigger aria-label="From" className="text-foreground">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{accounts.map(account => (
									<SelectItem key={account.name} value={account.name}>
										{accountLabel(account)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : (
					<p className="mt-2 px-1 text-xs text-muted-foreground">From {accountLabel(sender)}</p>
				))}
		</div>
	);
}

const NEW_MAIL: MailDocument = { to: [], cc: [], bcc: [], subject: "", body: "" };

/**
 * The latest conversations of the Gmail inboxes `workspace` shows, newest first, each tagged with its inbox while there
 * are several and narrowed to one by the sidebar's picker, beside the conversation `target` names, or Gmail's
 * integration row while omp can read none of them. A conversation that opens from the address while the picker narrows
 * to another account picks its own. With no conversation open, ↓ and ↑ focus the next and previous row;
 * with one open, they open the next and previous one and focus its row, which they read ahead. Esc closes it, and O
 * opens the focused row in Gmail, else the open conversation.
 */
export function InboxPage({ target, workspace }: { target: InboxRoute["target"]; workspace: string | null }) {
	const { gmail, inbox, accounts, picked, pick, threads: shownThreads } = useGmailInbox(workspace);
	const threads = picked === null ? shownThreads : shownThreads.filter(thread => thread.account === picked);
	const unread = threads.filter(thread => thread.unread).length;
	const read = inbox.read;
	const open = target === null || target === "new" ? null : target;
	const at = open === null ? -1 : threads.findIndex(thread => thread.account === open.account && thread.id === open.thread);
	const addressOf = (account: AccountId): string | null => gmail?.accounts.find(candidate => candidate.name === account)?.address ?? null;
	const openAddress = open && addressOf(open.account);
	const openUrl = open && openAddress !== null ? threadUrl(openAddress, open.thread) : null;
	const tagged = picked === null && accounts.length > 1;
	const openKey = open && rowId({ account: open.account, id: open.thread });
	useReturnFocus(openKey, id => id, id => document.getElementById(id)?.querySelector<HTMLElement>("a"), read);
	useOpenLatest(hashForInbox, target, threads[0] ? { account: threads[0].account, thread: threads[0].id } : null, read !== null);

	// A conversation opened from the address picks its own account, unless every inbox shows; a pick made while one is
	// open changes no hash, so it leaves the conversation open.
	useEffect(() => {
		const follow = (): void => {
			const route = routeFromHash(location.hash);
			const page = route.kind === "page" ? route.page : null;
			const opened = page?.kind === "inbox" && page.target !== null && page.target !== "new" ? page.target.account : null;
			if (opened !== null) pick(stored => (stored === null ? null : opened));
		};
		follow();
		window.addEventListener("hashchange", follow);
		return () => window.removeEventListener("hashchange", follow);
	}, [pick]);

	// Read the next and previous conversations while one is open, so ↓/↑ open them at once.
	const previous = at > 0 ? threads[at - 1] : undefined;
	const next = at >= 0 ? threads[at + 1] : undefined;
	useEffect(() => {
		if (previous) mailThreadStore.ensure(mailThreadScope(previous.account, previous.id));
		if (next) mailThreadStore.ensure(mailThreadScope(next.account, next.id));
	}, [previous, next]);

	const openThread = (thread: MailThread): void => {
		location.hash = hashForInbox({ account: thread.account, thread: thread.id });
		const row = rowOf(thread);
		if (row) focusRow(row);
	};
	const openBy = (by: 1 | -1): void => {
		const neighbour = at >= 0 ? threads[at + by] : threads[by === 1 ? 0 : threads.length - 1];
		if (neighbour) openThread(neighbour);
	};
	const step = (by: 1 | -1): boolean => {
		if (open === null && target !== "new") return stepRows(threads, rowOf, by);
		openBy(by);
		return true;
	};
	useShortcuts({
		inboxCompose: () => {
			if (target === "new") return false;
			location.hash = hashForInbox("new");
		},
		inboxNext: () => step(1),
		inboxPrevious: () => step(-1),
		inboxClose: () => {
			if (open === null) return false;
			location.hash = hashForInbox(null);
		},
		inboxOnGmail: () => {
			const url = threads.find(thread => rowOf(thread)?.contains(document.activeElement))?.url ?? openUrl;
			if (!url) return false;
			window.open(url, "_blank", "noopener,noreferrer");
		},
	});

	if (gmail && !anyCallable(gmail.accounts)) return <DisconnectedPage title={TITLE} meta={META} integration={gmail} />;

	const pickedAccount = accounts.find(account => account.name === picked);
	const scope = pickedAccount ? accountLabel(pickedAccount) : accounts.length === 1 && accounts[0] ? accountLabel(accounts[0]) : `${accounts.length} inboxes`;
	const failed = (read?.data.accounts ?? []).filter(account => account.error !== null && accounts.some(shown => shown.name === account.account) && (picked === null || account.account === picked));
	const senders = accounts.filter(account => callable(account.connection));
	return (
		<PolledPageFrame
			title={TITLE}
			meta={read ? `${scope} · ${unread} unread` : META}
			poll={inbox}
			onRefresh={() => void gmailStore.refresh(null, { fresh: true })}
			actions={
				<Tooltip content="New mail" shortcut={shortcutLabels("inboxCompose")}>
					<Button variant="secondary" size="compact" leadingIcon={SquarePen} render={<a href={hashForInbox("new")} />}>
						Compose
					</Button>
				</Tooltip>
			}
		>
			<ListSplit
				widthKey="omp-agents.inbox-list-width"
				resizeLabel="Resize the conversation list"
				detailLabel={target === "new" ? "New mail" : "Open conversation"}
				empty={{ icon: Mail, title: "No conversation open", hint: `Click one, or focus one with ${shortcutKeys("inboxNext")} and press Enter.` }}
				list={
					<div className="space-y-2 p-2">
						{failed.map(account => (
							<p key={account.account} role="alert" className="px-3 text-xs text-red-600 dark:text-red-400">
								Cannot read {addressOf(account.account) ?? account.account}: {account.error}
							</p>
						))}
						<PolledContent noun="your inbox" loading="Asking Gmail for your inbox…" poll={inbox}>
							{() =>
								threads.length === 0 ? (
									<p className="px-3 text-sm text-muted-foreground">Your inbox is empty.</p>
								) : (
									<ul aria-label="Conversations" className="space-y-0.5">
										{threads.map(thread => (
											<ThreadRow
												key={rowId(thread)}
												thread={thread}
												open={open !== null && thread.account === open.account && thread.id === open.thread}
												inbox={tagged ? (addressOf(thread.account) ?? thread.account) : null}
											/>
										))}
									</ul>
								)
							}
						</PolledContent>
					</div>
				}
				detail={
					target === null ? null : target === "new" ? (
						<ComposePage accounts={senders} from={picked} />
					) : (
						<ThreadDetail
							key={rowId({ account: target.account, id: target.thread })}
							target={target}
							listed={threads[at] ?? null}
							position={at >= 0 ? { at, of: threads.length } : null}
							onPrevious={previous ? () => openThread(previous) : undefined}
							onNext={next ? () => openThread(next) : undefined}
							address={openAddress}
							onTrashed={() => {
								const after = next ?? previous;
								if (after) openThread(after);
								else location.hash = hashForInbox(null);
							}}
						/>
					)
				}
			/>
		</PolledPageFrame>
	);
}
