import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { hashForSettings, SETTINGS_SECTIONS, type SettingsRoute } from "../../routing";

const GROUPS = [
	{ scope: "general", label: "General" },
	{ scope: "workspace", label: "Workspace" },
] as const;

/** The Settings tab of the sidebar: the sections that are the same in every workspace, then those the workspace picker changes. */
export function SettingsNav({ route: { section, cwd } }: { route: SettingsRoute }) {
	return GROUPS.map(group => (
		<SidebarGroup key={group.scope}>
			<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
			<SidebarMenu aria-label={`${group.label} settings`}>
				{SETTINGS_SECTIONS.filter(({ scope }) => scope === group.scope).map(({ value, label, icon }) => (
					<SidebarMenuItem key={value}>
						<SidebarMenuButton asChild icon={icon} isActive={section === value}>
							<a href={hashForSettings(value, cwd)} aria-current={section === value ? "page" : undefined}>
								{label}
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	));
}
