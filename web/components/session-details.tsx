import { GitPullRequest, Images, TableOfContents } from "lucide-react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { RosterHost, View } from "../../src/shared/sessions";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { useMedia, useTurnCount } from "../pane-store";
import { useStoredState } from "../stored-state";
import { MediaTab } from "./media-tab";
import { OutlineTab } from "./outline-tab";
import { PullRequestsTab } from "./pull-requests-tab";

/** The right sidebar's tab, which localStorage keeps across views. The key keeps its old name, and a tab that no longer exists reads as the outline. */
const TAB_KEY = "omp-agents.plan-tab";

const DETAILS_TABS = ["outline", "media", "pull-requests"] as const;
type DetailsTab = (typeof DETAILS_TABS)[number];

/** Each tab names itself and counts its items in a badge, which screen readers hear through the tab's name. */
function tabLabel(name: string, count: number): { label: string; badge: number | undefined; "aria-label": string | undefined } {
	return count > 0 ? { label: name, badge: count, "aria-label": `${name} (${count})` } : { label: name, badge: undefined, "aria-label": undefined };
}

/** The labeled tabs fit the sidebar's default width only with tighter padding than Fluid's, and only without their icons. */
const TAB_CLASS = "px-2 @max-[23rem]/sidebar:[&>svg]:hidden";

/** Keeps each tab's content off the header's hairline at rest, and scrolls away with it. */
const PANEL_VIEWPORT = "pt-2";

/** The PRs tab pins its pull request's header to the top edge, which must neither fade nor sit below a padding that the text scrolls through. */
const PINNED_VIEWPORT = "scroll-fade-bottom-only";

interface SessionDetailsProps {
	view: View;
	/** Marks the last turn as still running; a change also reads the shown pull request again. */
	working: boolean;
	/** What the view's session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The sidebar's project `cwd`, or `null` for every project. */
	project: string | null;
	hosts: RosterHost[];
}

/**
 * The right sidebar's content for the focused view: an outline of its conversation's turns, the images its agents' tools
 * returned, and its session's pull requests, each tab apart.
 */
export function SessionDetails({ view, working, pullRequests, project, hosts }: SessionDetailsProps) {
	const media = useMedia(view);
	const turnCount = useTurnCount(view);
	const [tab, setTab] = useStoredState<DetailsTab>(TAB_KEY, raw => DETAILS_TABS.find(tab => tab === raw) ?? "outline");
	return (
		<Tabs value={tab} onValueChange={value => setTab(value as DetailsTab)} className="@container/sidebar flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="h-(--page-header-height) flex-row items-center gap-2 border-b border-border px-2 py-0">
				<h2 className="sr-only">Session details</h2>
				<SizeProvider size="compact">
					<TabsList aria-label="Session details">
						<TabItem value="outline" icon={TableOfContents} className={TAB_CLASS} {...tabLabel("Outline", turnCount)} />
						<TabItem value="media" icon={Images} className={TAB_CLASS} {...tabLabel("Media", media?.length ?? 0)} />
						<TabItem value="pull-requests" icon={GitPullRequest} className={TAB_CLASS} {...tabLabel("PRs", pullRequests.length)} />
					</TabsList>
				</SizeProvider>
			</SidebarHeader>
			<TabPanel value="outline" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					<OutlineTab view={view} working={working} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="media" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					<MediaTab media={media} view={view} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="pull-requests" asChild>
				<SidebarContent viewportClassName={PINNED_VIEWPORT}>
					<PullRequestsTab pullRequests={pullRequests} project={project} hosts={hosts} version={working} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
