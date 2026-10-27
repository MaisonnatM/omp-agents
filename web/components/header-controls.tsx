/** The Dev and Ops switch, the command menu button, the notices' bell, and Settings: in the desktop app's title bar, else at the end of the page's header. */
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { createContext, memo, type ReactNode, useContext, useSyncExternalStore } from "react";
import type { Notice } from "../../src/shared/notices";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { PAGE_ICON } from "../page-icons";
import { TAB_GROUPS, type TabGroup } from "../routing";
import { shortcutLabels } from "../shortcuts";
import { NoticesBell } from "./notices";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "./segmented-tabs";

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

/** Whether the window's history has an entry behind and ahead, from the Navigation API that Electron's Chromium provides. */
function subscribeHistory(onChange: () => void) {
	navigation.addEventListener("currententrychange", onChange);
	return () => navigation.removeEventListener("currententrychange", onChange);
}
const historyEnds = () => (navigation.canGoBack ? 1 : 0) | (navigation.canGoForward ? 2 : 0);

function HistoryButtons() {
	const ends = useSyncExternalStore(subscribeHistory, historyEnds);
	return (
		<div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
			<Tooltip content="Back" shortcut={shortcutLabels("back")} side="bottom">
				<Button {...activityControl("header.back")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Back" disabled={!(ends & 1)} onClick={() => history.back()}>
					<ChevronLeft />
				</Button>
			</Tooltip>
			<Tooltip content="Forward" shortcut={shortcutLabels("forward")} side="bottom">
				<Button {...activityControl("header.forward")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Forward" disabled={!(ends & 2)} onClick={() => history.forward()}>
					<ChevronRight />
				</Button>
			</Tooltip>
		</div>
	);
}

/** The window's title bar: a drag strip with the window's buttons inset at its left, then Back and Forward, the document title centered, and the controls at its right. */
export function DesktopTitleBar({ title, controls }: { title: string; controls: ReactNode }) {
	return (
		<div className="relative flex h-9 shrink-0 items-center justify-between border-b border-border bg-sidebar pr-3 pl-[78px] select-none [-webkit-app-region:drag]">
			<p className="pointer-events-none absolute inset-x-40 truncate text-center text-[13px] font-medium text-muted-foreground">{title}</p>
			<HistoryButtons />
			<div className="[-webkit-app-region:no-drag]">{controls}</div>
		</div>
	);
}
