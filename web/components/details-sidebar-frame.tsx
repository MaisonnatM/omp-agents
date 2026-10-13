/** The right sidebar's shell for a focused view: the directory its file references resolve against, a header of counted tabs, and each tab's panel. */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { useStoredState } from "../stored-state";
import { FileBaseContext } from "./file-link";

/** The labeled tabs fit the sidebar's default width only with tighter padding than Fluid's, and only without their icons. */
const TAB_CLASS = "px-2 @max-[23rem]/sidebar:[&>svg]:hidden";

/** Keeps each tab's content off the header's hairline at rest, and scrolls away with it. */
const PANEL_VIEWPORT = "pt-2";

/** A pinned panel keeps its header at the top edge, which must neither fade nor sit below a padding that the text scrolls through. */
const PINNED_VIEWPORT = "scroll-fade-bottom-only";

export interface DetailsTab<T extends string> {
	value: T;
	icon: LucideIcon;
	name: string;
	/** Shown as a badge, which screen readers hear through the tab's name; zero shows none. */
	count: number;
	/** The panel pins its own header to the top edge instead of padding below the sidebar's. */
	pinned?: boolean;
	content: ReactNode;
}

interface DetailsSidebarFrameProps<T extends string> {
	/** The heading and tab list's accessible name. */
	label: string;
	/** The localStorage key keeping the chosen tab across views. */
	storageKey: string;
	/** The tab shown when none is stored, or the stored one no longer exists. */
	defaultTab: T;
	/** The focused view's directory, which relative file references in every tab resolve against. */
	cwd: string | null;
	tabs: readonly DetailsTab<T>[];
}

/** Each tab names itself and counts its items in a badge, which screen readers hear through the tab's name. */
function tabLabel(name: string, count: number): { label: string; badge: number | undefined; "aria-label": string | undefined } {
	return count > 0 ? { label: name, badge: count, "aria-label": `${name} (${count})` } : { label: name, badge: undefined, "aria-label": undefined };
}

export function DetailsSidebarFrame<T extends string>({ label, storageKey, defaultTab, cwd, tabs }: DetailsSidebarFrameProps<T>) {
	const [tab, setTab] = useStoredState<T>(storageKey, raw => tabs.find(each => each.value === raw)?.value ?? defaultTab);
	return (
		<FileBaseContext.Provider value={cwd}>
			<Tabs value={tab} onValueChange={value => setTab(value as T)} className="@container/sidebar flex min-h-0 flex-1 flex-col">
				<SidebarHeader className="h-(--page-header-height) flex-row items-center gap-2 border-b border-border px-2 py-0">
					<h2 className="sr-only">{label}</h2>
					<SizeProvider size="compact">
						<TabsList aria-label={label}>
							{tabs.map(each => (
								<TabItem key={each.value} value={each.value} icon={each.icon} className={TAB_CLASS} {...tabLabel(each.name, each.count)} />
							))}
						</TabsList>
					</SizeProvider>
				</SidebarHeader>
				{tabs.map(each => (
					<TabPanel key={each.value} value={each.value} asChild>
						<SidebarContent viewportClassName={each.pinned ? PINNED_VIEWPORT : PANEL_VIEWPORT}>{each.content}</SidebarContent>
					</TabPanel>
				))}
			</Tabs>
		</FileBaseContext.Provider>
	);
}
