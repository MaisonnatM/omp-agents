/** The Dev and Ops switch, the command menu button, the notices' bell, and Settings: in the desktop app's title bar, else at the end of the page's header; and the title bar's Back and Forward buttons. */
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { createContext, memo, type ReactNode, useContext } from "react";
import type { Notice } from "../../src/shared/notices";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { PAGE_ICON } from "../page-icons";
import { TAB_GROUPS, type TabGroup } from "../routing";
import { shortcutLabels } from "../shortcuts";
import { useHistoryPosition } from "../use-history-position";
import { NoticesBell } from "./notices";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "./segmented-tabs";
import { WhatsNew } from "./whats-new";

/** The desktop app on macOS hides the system's title bar, so the page draws it, `DesktopTitleBar`, with these controls. */
export const DESKTOP_TITLE_BAR = typeof window !== "undefined" && window.ompDesktop?.titleBar === true;

/** What every `Header` ends with: `null` under the desktop title bar; a pane provides `null` and puts them before its sidebar toggle, in the top right pane only. */
export const HeaderControlsContext = createContext<ReactNode>(null);

export const useHeaderControls = (): ReactNode => useContext(HeaderControlsContext);

interface HeaderControlsProps {
	notices: Notice[];
	onShowSearch: () => void;
	/** The group whose tabs the sidebar's bar shows. */
	group: TabGroup;
	/** The groups with no tab shown, whose switch is disabled. */
	emptyGroups: ReadonlySet<TabGroup>;
	onGroup: (group: TabGroup) => void;
	settingsOpen: boolean;
	onToggleSettings: () => void;
}

const SettingsIcon = PAGE_ICON.settings;

export const HeaderControls = memo(function HeaderControls({ notices, onShowSearch, group, emptyGroups, onGroup, settingsOpen, onToggleSettings }: HeaderControlsProps) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<SegmentedTabs value={group} onValueChange={value => onGroup(value as TabGroup)}>
				<SegmentedTabsList {...activityControl("header.group")} aria-label="Sidebar tabs" className="rounded-md">
					{TAB_GROUPS.map(({ value, label }) => (
						<SegmentedTab key={value} value={value} disabled={emptyGroups.has(value)} className="h-5 rounded-sm px-2 text-2xs">
							{label}
						</SegmentedTab>
					))}
				</SegmentedTabsList>
			</SegmentedTabs>
			<Tooltip content="Command menu" shortcut={shortcutLabels("switcher")} side="bottom">
				<Button {...activityControl("header.command-menu")} variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="Command menu" onClick={onShowSearch}>
					<Search />
				</Button>
			</Tooltip>
			<WhatsNew />
			<NoticesBell notices={notices} />
			<Tooltip content={settingsOpen ? "Close settings" : "Settings"} shortcut={shortcutLabels("settings")} side="bottom">
				<Button
					{...activityControl("header.settings")}
					variant="ghost"
					size="icon-compact"
					className="shrink-0 text-muted-foreground aria-pressed:bg-selected aria-pressed:text-foreground"
					aria-label="Settings"
					aria-pressed={settingsOpen}
					onClick={onToggleSettings}
				>
					<SettingsIcon />
				</Button>
			</Tooltip>
		</div>
	);
});

/** The buttons act through `history`, as the shortcuts do in any browser. */
function HistoryButtons() {
	const { canGoBack, canGoForward } = useHistoryPosition();
	return (
		<div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
			<Tooltip content="Back" shortcut={shortcutLabels("back")} side="bottom" disabled={!canGoBack}>
				<Button {...activityControl("header.back")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Back" disabled={!canGoBack} onClick={() => history.back()}>
					<ChevronLeft />
				</Button>
			</Tooltip>
			<Tooltip content="Forward" shortcut={shortcutLabels("forward")} side="bottom" disabled={!canGoForward}>
				<Button {...activityControl("header.forward")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Forward" disabled={!canGoForward} onClick={() => history.forward()}>
					<ChevronRight />
				</Button>
			</Tooltip>
		</div>
	);
}

/** The window's title bar: a drag strip with the window's buttons inset at its left, then Back and Forward, the document title centered, and the controls at its right. */
export function DesktopTitleBar({ title, controls }: { title: string; controls: ReactNode }) {
	// pl-[78px] clears the window's buttons: `trafficLightPosition.x` 14 in desktop/main.ts, their 52px, and a 12px gap.
	// h-9 is also the `top-9` a maximized Browser leaves for it in browser-panel.tsx.
	return (
		<div className="relative flex h-9 shrink-0 items-center justify-between border-b border-border bg-sidebar pr-3 pl-[78px] select-none [-webkit-app-region:drag]">
			<p className="pointer-events-none absolute inset-x-40 truncate text-center text-[13px] font-medium text-muted-foreground">{title}</p>
			<HistoryButtons />
			<div className="[-webkit-app-region:no-drag]">{controls}</div>
		</div>
	);
}
