import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { hashForSettings, SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsRoute } from "../../routing";

/** The sidebar while the Settings page is open: each group's sections under its label, those the workspace picker changes last. */
export function SettingsNav({ route: { section } }: { route: SettingsRoute }) {
	return SETTINGS_GROUPS.map(group => (
		<SidebarGroup key={group.value}>
			<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
			<SidebarMenu aria-label={`${group.label} settings`}>
				{SETTINGS_SECTIONS.filter(entry => entry.group === group.value).map(({ value, label, icon }) => (
					<SidebarMenuItem key={value}>
						<SidebarMenuButton asChild icon={icon} isActive={section === value}>
							<a href={hashForSettings(value)} aria-current={section === value ? "page" : undefined}>
								{label}
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	));
}
