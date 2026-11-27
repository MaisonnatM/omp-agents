/** The Memory page: every workspace repository's project memory and glossary, and the bookmarks agents can search, under one header. */
import { activityControl } from "../../activity";
import { PageFrame } from "../list-page";
import type { CoreData } from "../module-views";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { BookmarksTab } from "./bookmarks";
import { GlossaryTab } from "./glossary";
import type { MemoryRoute } from "./module";
import { ProjectMemoryTab } from "./project-memory";
import { MEMORY_TABS, memoryHash } from "./tabs";

const META: Record<MemoryRoute["tab"], string> = {
	project: "What agents recorded with the project_memory tool, per repository",
	glossary: "The words each repository's GLOSSARY.md defines, which agents name things with",
	bookmarks: "Your Zen and x.com bookmarks, which agents search with the bookmarks tool",
};

export function MemoryPage({ route }: { route: MemoryRoute; core: CoreData }) {
	const body = route.tab === "project" ? <ProjectMemoryTab repo={route.repo} /> : route.tab === "glossary" ? <GlossaryTab repo={route.repo} /> : <BookmarksTab q={route.q} />;
	return (
		<PageFrame title="Memory" meta={META[route.tab]} actions={<ViewTabs tab={route.tab} />}>
			{body}
		</PageFrame>
	);
}

/** The Project memory, Glossary, and Bookmarks tabs. */
function ViewTabs({ tab }: { tab: MemoryRoute["tab"] }) {
	return (
		<SegmentedTabs
			value={tab}
			onValueChange={next => {
				const view = MEMORY_TABS.find(({ route }) => route.tab === next);
				if (view) location.hash = memoryHash(view.route);
			}}
			activation="manual"
		>
			<SegmentedTabsList aria-label="View">
				{MEMORY_TABS.map(({ route, name, control }) => (
					<SegmentedTab key={route.tab} value={route.tab} {...activityControl(control)}>
						{name}
					</SegmentedTab>
				))}
			</SegmentedTabsList>
		</SegmentedTabs>
	);
}
