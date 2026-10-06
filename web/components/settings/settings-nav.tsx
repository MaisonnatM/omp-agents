import { BarChart3, FileText, GitBranch, Palette, Plug, RotateCcw, Route, Sparkles } from "lucide-react";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export const SETTINGS_TABS = [
	{ value: "analytics", label: "Analytics", icon: BarChart3 },
	{ value: "roles", label: "Model roles & provider order", icon: Route },
	{ value: "retry", label: "Retry and fallback", icon: RotateCcw },
	{ value: "files", label: "Files", icon: FileText },
	{ value: "worktrees", label: "Worktrees", icon: GitBranch },
	{ value: "integrations", label: "Integrations", icon: Plug },
	{ value: "new-sessions", label: "New sessions", icon: Sparkles },
	{ value: "appearance", label: "Appearance", icon: Palette },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

export function SettingsNav({ tab, onTab }: { tab: SettingsTab; onTab: (tab: SettingsTab) => void }) {
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Settings sections">
				{SETTINGS_TABS.map(({ value, label, icon }) => (
					<SidebarMenuItem key={value}>
						<SidebarMenuButton
							icon={icon}
							isActive={tab === value}
							aria-current={tab === value ? "true" : undefined}
							aria-controls={`settings-panel-${value}`}
							onClick={() => onTab(value)}
						>
							{label}
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
