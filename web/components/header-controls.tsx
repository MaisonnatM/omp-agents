/** The Personal and Work switch, the Notes, Calendar, Email, and Sport buttons, the command menu button, the notices' bell, and Settings: in the desktop app's title bar, else at the end of the page's header, where a phone gets one menu of every tab instead; and the title bar's Back and Forward buttons. */
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { createContext, memo, type ReactNode, useContext } from "react";
import type { Notice } from "../../src/shared/notices";
import { isSpace, type Space, SPACES } from "../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@/components/ui/menu";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { activityControl } from "../activity";
import { SPACE_LABELS, sessionsWaiting } from "../labels";
import { PAGE_ICON, SPACE_ICONS } from "../page-icons";
import type { SidebarPanel, SidebarTab } from "../routing";
import { shortcutLabels } from "../shortcuts";
import { TAB_ROWS } from "../sidebar-tabs";
import { useHistoryPosition } from "../use-history-position";
import { usePhoneWidth } from "../use-phone-width";
import { NoticesBell } from "./notices";
import { WhatsNew } from "./whats-new";

/** The desktop app on macOS hides the system's title bar, so the page draws it, `DesktopTitleBar`, with these controls. */
export const DESKTOP_TITLE_BAR = typeof window !== "undefined" && window.ompDesktop?.titleBar === true;

/** What every `Header` ends with: `null` under the desktop title bar; a pane provides `null` and puts them before its sidebar toggle, in the top right pane only. */
export const HeaderControlsContext = createContext<ReactNode>(null);

export const useHeaderControls = (): ReactNode => useContext(HeaderControlsContext);

interface HeaderControlsProps {
	notices: Notice[];
	onShowSearch: () => void;
	/** The shown tabs whose triggers sit here, after the command menu button between two dividers, in order. */
	tabs: readonly SidebarTab[];
	/** Every shown tab, in order, which a phone lists in one menu in place of the sidebar's bar and the header's buttons. */
	allTabs: readonly SidebarTab[];
	/** The panel the sidebar shows, whose button is pressed. */
	tab: SidebarPanel;
	onTab: (tab: SidebarTab) => void;
	settingsOpen: boolean;
	onToggleSettings: () => void;
	/** The space the window shows, which the switch at the start of the controls changes, under the desktop title bar beside Back and Forward instead. */
	space: Space;
	onSpace: (space: Space) => void;
	/** How many sessions of the other space need you, which the switch counts on that space's side. */
	otherWaiting: number;
}

type SpaceSwitchProps = Pick<HeaderControlsProps, "space" | "onSpace" | "otherWaiting">;

const SettingsIcon = PAGE_ICON.settings;

/**
 * Which space the window shows, Personal or Work; the switch shortcut's keys show on the space it goes to, and so does the count
 * of that space's sessions that need you, so they do not wait unseen. Each tab keeps its tooltip whichever space is on, so switching
 * leaves the tab mounted and the keyboard focus on it. In a page's header narrower than 56rem the labels leave the icons alone,
 * their names kept in the tooltip and for screen readers.
 */
function SpaceSwitch({ space, onSpace, otherWaiting }: SpaceSwitchProps) {
	return (
		<SizeProvider size="compact">
			<Tabs
				value={space}
				onValueChange={value => {
					if (isSpace(value)) onSpace(value);
				}}
			>
				<TabsList aria-label="Space">
					{SPACES.map(value => {
						const waiting = value === space ? 0 : otherWaiting;
						return (
							<TabItem
								key={value}
								{...activityControl(`header.space.${value}` as const)}
								value={value}
								icon={SPACE_ICONS[value]}
								label={SPACE_LABELS[value]}
								labelClassName="@max-[56rem]/header:sr-only"
								tooltip={waiting > 0 ? `${SPACE_LABELS[value]} · ${sessionsWaiting(waiting)}` : SPACE_LABELS[value]}
								shortcut={value === space ? undefined : shortcutLabels("switchSpace")}
								badge={waiting > 0 ? waiting : undefined}
								aria-label={waiting > 0 ? `${SPACE_LABELS[value]}, ${sessionsWaiting(waiting)}` : undefined}
							/>
						);
					})}
				</TabsList>
			</Tabs>
		</SizeProvider>
	);
}

/**
 * A phone's one way to every tab: the button names the tab on, and its menu lists every shown tab, then the space and Settings,
 * so the header holds this menu, the command menu, and the bell.
 */
function PhoneTabMenu({ tabs, tab, onTab, settingsOpen, onToggleSettings, space, onSpace }: Omit<HeaderControlsProps, "notices" | "onShowSearch" | "allTabs" | "otherWaiting">) {
	const current = tab === "settings" ? { label: "Settings", icon: SettingsIcon } : TAB_ROWS[tab];
	const CurrentIcon = current.icon;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button {...activityControl("header.tab-menu")} variant="ghost" size="compact" className="min-w-0 gap-1.5 px-2 font-medium text-foreground [&_svg]:size-3.5" aria-label={`${current.label}. Go to another tab`} />}
			>
				<CurrentIcon />
				<span className="truncate">{current.label}</span>
				<ChevronDown className="text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<MenuRadioGroup value={tab} onValueChange={(value: SidebarTab) => onTab(value)}>
					{tabs.map(value => {
						const { label, icon: Icon } = TAB_ROWS[value];
						return (
							<MenuRadioItem key={value} value={value} closeOnClick>
								<Icon />
								{label}
							</MenuRadioItem>
						);
					})}
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuRadioGroup
					value={space}
					onValueChange={(value: string) => {
						if (isSpace(value)) onSpace(value);
					}}
				>
					{SPACES.map(value => {
						const Icon = SPACE_ICONS[value];
						return (
							<MenuRadioItem key={value} value={value} closeOnClick>
								<Icon />
								{SPACE_LABELS[value]}
							</MenuRadioItem>
						);
					})}
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuItem onClick={onToggleSettings}>
					<SettingsIcon />
					{settingsOpen ? "Close settings" : "Settings"}
				</MenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export const HeaderControls = memo(function HeaderControls({ notices, onShowSearch, tabs, allTabs, tab, onTab, settingsOpen, onToggleSettings, space, onSpace, otherWaiting }: HeaderControlsProps) {
	const phone = usePhoneWidth();
	const commandMenu = (
		<Tooltip content="Command menu" shortcut={shortcutLabels("switcher")} side="bottom">
			<Button {...activityControl("header.command-menu")} variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="Command menu" onClick={onShowSearch}>
				<Search />
			</Button>
		</Tooltip>
	);
	if (phone)
		return (
			<div className="flex min-w-0 items-center gap-1">
				<PhoneTabMenu tabs={allTabs} tab={tab} onTab={onTab} settingsOpen={settingsOpen} onToggleSettings={onToggleSettings} space={space} onSpace={onSpace} />
				{commandMenu}
				<NoticesBell notices={notices} />
			</div>
		);
	return (
		<div className="flex shrink-0 items-center gap-1">
			{!DESKTOP_TITLE_BAR && <SpaceSwitch space={space} onSpace={onSpace} otherWaiting={otherWaiting} />}
			{commandMenu}
			{tabs.length > 0 && (
				<>
					<span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
					{tabs.map(value => {
						const { label, icon: Icon } = TAB_ROWS[value];
						return (
							<Tooltip key={value} content={label} shortcut={shortcutLabels(value)} side="bottom">
								<Button
									{...activityControl("header.tab")}
									variant="ghost"
									size="icon-compact"
									className="shrink-0 text-muted-foreground aria-pressed:bg-selected aria-pressed:text-foreground"
									aria-label={label}
									aria-pressed={tab === value}
									onClick={() => onTab(value)}
								>
									<Icon />
								</Button>
							</Tooltip>
						);
					})}
					<span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
				</>
			)}
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

/** The window's title bar: a drag strip with the window's buttons inset at its left, then Back and Forward and the document title, the space switch centered, and the controls at its right. */
export function DesktopTitleBar({ title, controls, ...spaceSwitch }: SpaceSwitchProps & { title: string; controls: ReactNode }) {
	// `env(titlebar-area-x)` is where the window's buttons end, with a gap as wide as their inset; desktop/main.ts turns it on with `titleBarOverlay`.
	// h-9 is also the `top-9` a maximized Browser leaves for it in browser-panel.tsx.
	// Equal side columns keep the switch at the window's center whatever the title's length.
	return (
		<div className="grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-sidebar pr-3 pl-[env(titlebar-area-x)] select-none [-webkit-app-region:drag]">
			<div className="flex min-w-0 items-center gap-2">
				<HistoryButtons />
				<p className="pointer-events-none min-w-0 truncate text-[13px] font-medium text-muted-foreground">{title}</p>
			</div>
			<div className="[-webkit-app-region:no-drag]">
				<SpaceSwitch {...spaceSwitch} />
			</div>
			<div className="justify-self-end [-webkit-app-region:no-drag]">{controls}</div>
		</div>
	);
}
