/** The right sidebar's shell for a focused view: the directory its file references resolve against, a header of counted tabs, and each tab's panel. */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { useStoredState } from "../stored-state";
import { FileBaseContext } from "./file-link";

/** Four labeled tabs fit the sidebar's default width only with tighter padding than Fluid's, and only without their icons. */
const TAB_CLASS = "px-2 @max-[23rem]/sidebar:[&>svg]:hidden";

/** Five tabs fit it only as icons, whose labels the screen reader and the tooltip still name, until the sidebar is widened past them. */
const CROWDED_TAB_CLASS = "px-2";
const CROWDED_LABEL_CLASS = "@max-[30rem]/sidebar:sr-only";

/** Keeps each tab's content off the header's hairline at rest, and scrolls away with it. */
const PANEL_VIEWPORT = "pt-2";

export interface DetailsTab<T extends string> {
	value: T;
	icon: LucideIcon;
	name: string;
	/** Shown as a badge, which screen readers hear through the tab's name; zero shows none. */
	count: number;
	/** The content scrolls itself inside the panel's full height, as a pull request's details do below their header and tabs. */
	scrollsItself?: boolean;
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


/** A tab with nothing to show yet. */
export function DetailsEmpty({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
	return (
		<Empty className="py-10">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription className="text-xs/relaxed">{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

export function DetailsSidebarFrame<T extends string>({ label, storageKey, defaultTab, cwd, tabs }: DetailsSidebarFrameProps<T>) {
	// Resolved each render, not when read: a tab that shows only once its items arrive, such as Tickets, takes the stored choice then.
	const [stored, setTab] = useStoredState<string>(storageKey, raw => raw ?? defaultTab);
	const tab = tabs.find(each => each.value === stored)?.value ?? defaultTab;
	const crowded = tabs.length > 4;
	return (
		<FileBaseContext.Provider value={cwd}>
			<Tabs value={tab} onValueChange={value => setTab(String(value))} className="@container/sidebar flex min-h-0 flex-1 flex-col">
				<SidebarHeader className="h-(--page-header-height) flex-row items-center gap-2 border-b border-border px-2 py-0">
					<h2 className="sr-only">{label}</h2>
					<SizeProvider size="compact">
						<TabsList aria-label={label}>
							{tabs.map(each => (
								<TabItem
									key={each.value}
									value={each.value}
									icon={each.icon}
									className={crowded ? CROWDED_TAB_CLASS : TAB_CLASS}
									labelClassName={crowded ? CROWDED_LABEL_CLASS : undefined}
									{...tabLabel(each.name, each.count)}
								/>
							))}
						</TabsList>
					</SizeProvider>
				</SidebarHeader>
				{tabs.map(each =>
					each.scrollsItself ? (
						<TabPanel key={each.value} value={each.value} className="flex min-h-0 flex-1 flex-col">
							{each.content}
						</TabPanel>
					) : (
						<TabPanel key={each.value} value={each.value} asChild>
							<SidebarContent viewportClassName={PANEL_VIEWPORT}>{each.content}</SidebarContent>
						</TabPanel>
					),
				)}
			</Tabs>
		</FileBaseContext.Provider>
	);
}
