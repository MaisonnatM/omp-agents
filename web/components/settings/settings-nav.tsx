import { useState } from "react";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { isPhonePage } from "../../api";
import { hashForSettings, type SettingsRoute, settingsMatching } from "../../routing";
import { Kbd } from "../kbd";
import { SidebarSearch } from "../sidebar-search";

/** The sidebar while the Settings page is open: a search over the sections' names and keywords, where Enter opens the first match, then each group's sections under its label, those the workspace picker changes last. */
export function SettingsNav({ route: { section } }: { route: SettingsRoute }) {
	const [query, setQuery] = useState("");
	const groups = settingsMatching(query, { phone: isPhonePage() });
	const first = query.trim() ? groups[0]?.entries[0] : undefined;
	return (
		<>
			<SidebarGroup>
				<SidebarSearch
					label="Filter the settings"
					placeholder="Search settings"
					query={query}
					onQuery={setQuery}
					onEnter={first ? () => (location.hash = hashForSettings(first.value)) : undefined}
				/>
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
								{value === first?.value && <Kbd aria-hidden size="sm" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">↵</Kbd>}
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			))}
		</>
	);
}
