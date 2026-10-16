import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { AccountId } from "../../../src/shared/accounts";
import { useGmailInbox } from "../../reads";

/**
 * The Inbox tab of the sidebar, for the Gmail accounts `workspace` shows: with one, its address over the Inbox; with
 * several, every inbox and then each account's, the one the Inbox page narrows to marked, each with its unread count.
 * Picking one narrows the list and leaves an open conversation open.
 */
export function InboxNav({ workspace }: { workspace: string | null }) {
	const { accounts, picked, pick, threads } = useGmailInbox(workspace);
	const unreadOf = (account: AccountId | null): number => threads.filter(thread => thread.unread && (account === null || thread.account === account)).length;
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
							<SidebarMenuButton isActive={active} aria-pressed={active} aria-label={unread > 0 ? `${label}, ${unread} unread` : label} title={label} onClick={() => pick(account)}>
								<span className="truncate">{label}</span>
							</SidebarMenuButton>
							{unread > 0 && <SidebarMenuBadge aria-hidden>{unread}</SidebarMenuBadge>}
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
