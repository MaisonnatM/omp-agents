import { useState } from "react";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { isPhonePage } from "../../api";
import { hashForSettings, SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsRoute } from "../../routing";
import { SidebarSearch } from "../sidebar-search";

/** The sidebar while the Settings page is open: a search over the sections' names and keywords, then each group's sections under its label, those the workspace picker changes last. */
export function SettingsNav({ route: { section } }: { route: SettingsRoute }) {
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const sections = SETTINGS_SECTIONS.filter(
		entry => !(isPhonePage() && entry.value === "phone") && (!needle || [entry.label, ...entry.keywords].some(text => text.toLowerCase().includes(needle))),
	);
	const groups = SETTINGS_GROUPS.map(group => ({ group, entries: sections.filter(entry => entry.group === group.value) })).filter(({ entries }) => entries.length > 0);
	return (
		<>
			<SidebarGroup>
				<SidebarSearch label="Filter the settings" placeholder="Search settings" query={query} onQuery={setQuery} />
			</SidebarGroup>
			{groups.length === 0 && (
				<SidebarGroup>
					<p className="px-2 py-1 text-xs text-muted-foreground">{`No settings match “${query.trim()}”`}</p>
				</SidebarGroup>
			)}
			{groups.map(({ group, entries }) => (
				<SidebarGroup key={group.value}>
					<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
					<SidebarMenu aria-label={`${group.label} settings`}>
						{entries.map(({ value, label, icon }) => (
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
			))}
		</>
	);
}
