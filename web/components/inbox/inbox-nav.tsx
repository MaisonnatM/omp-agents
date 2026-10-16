import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { AccountId } from "../../../src/shared/accounts";
import { useGmailInbox } from "../../reads";
import { hashForInbox } from "../../routing";

/**
 * The Inbox tab of the sidebar, for the Gmail accounts `workspace` shows: with one, its address over the Inbox; with
 * several, every inbox and then each account's, the one the Inbox page narrows to marked, each with its unread count.
 */
export function InboxNav({ workspace }: { workspace: string | null }) {
	const { inbox, accounts, picked, pick } = useGmailInbox(workspace);
	const answer = inbox.read?.data;
	const shown = new Set(accounts.map(account => account.name));
	const unreadOf = (account: AccountId | null): number =>
		(answer?.threads ?? []).filter(thread => thread.unread && (account === null ? shown.has(thread.account) : thread.account === account)).length;
	const [only] = accounts;
	const entries: { account: AccountId | null; label: string }[] =
		accounts.length > 1 ? [{ account: null, label: "All inboxes" }, ...accounts.map(account => ({ account: account.name, label: account.address ?? account.name }))] : [{ account: null, label: "Inbox" }];
	return (
		<SidebarGroup>
			{accounts.length === 1 && only?.address && <SidebarGroupLabel title={only.address}>{only.address}</SidebarGroupLabel>}
			<SidebarMenu aria-label="Mailboxes">
				{entries.map(({ account, label }) => {
					const unread = unreadOf(account);
					const active = picked === account;
					return (
						<SidebarMenuItem key={account ?? ""}>
							<SidebarMenuButton asChild isActive={active}>
								<a href={hashForInbox(null)} aria-current={active ? "page" : undefined} aria-label={unread > 0 ? `${label}, ${unread} unread` : label} title={label} onClick={() => pick(account)}>
									<span className="truncate">{label}</span>
								</a>
							</SidebarMenuButton>
							{unread > 0 && <SidebarMenuBadge aria-hidden>{unread}</SidebarMenuBadge>}
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
