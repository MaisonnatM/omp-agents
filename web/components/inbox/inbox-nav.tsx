import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useGmailInbox } from "../../reads";
import { hashForInbox } from "../../routing";

/** The Inbox tab of the sidebar: the signed-in address over the Inbox, with its unread count. */
export function InboxNav() {
	const { inbox, unread } = useGmailInbox();
	const read = inbox.read?.data;
	return (
		<SidebarGroup>
			{read && <SidebarGroupLabel title={read.address}>{read.address}</SidebarGroupLabel>}
			<SidebarMenu aria-label="Mailboxes">
				<SidebarMenuItem>
					<SidebarMenuButton asChild isActive>
						<a href={hashForInbox(null)} aria-current="page" aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}>
							Inbox
						</a>
					</SidebarMenuButton>
					{unread > 0 && <SidebarMenuBadge aria-hidden>{unread}</SidebarMenuBadge>}
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarGroup>
	);
}
