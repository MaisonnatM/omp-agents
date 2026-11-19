/** The Memory page: omp memory, every workspace repository's project memory, and the bookmarks agents can search, under one header. */
import type { ReactNode } from "react";
import { activityControl } from "../../activity";
import { hashForSettings } from "../../routing";
import { PageFrame } from "../list-page";
import type { CoreData } from "../module-views";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { settingsReadNote, useSettingsEditing } from "../settings/editor";
import { OmpMemoryTab } from "../settings/omp-memory-tab";
import { BookmarksTab } from "./bookmarks";
import type { MemoryRoute } from "./module";
import { ProjectMemoryTab } from "./project-memory";
import { MEMORY_TABS, memoryHash } from "./tabs";

const META: Record<MemoryRoute["tab"], string> = {
	omp: "What omp remembers in the sidebar's workspace",
	project: "What agents recorded with the project_memory tool, per repository",
	bookmarks: "Your Zen and x.com bookmarks, which agents search with the bookmarks tool",
};

export function MemoryPage({ route, core }: { route: MemoryRoute; core: CoreData }) {
	const cwd = core.workspace;
	let body: ReactNode;
	if (route.tab === "omp") body = <OmpMemory key={cwd ?? ""} cwd={cwd} />;
	else if (route.tab === "project") body = <ProjectMemoryTab repo={route.repo} cwd={cwd} />;
	else body = <BookmarksTab key={route.q} q={route.q} />;
	return (
		<PageFrame title="Memory" meta={META[route.tab]} actions={<ViewTabs tab={route.tab} />}>
			{body}
		</PageFrame>
	);
}

/** Settings › omp memory, for the sidebar's workspace; its file links open Settings › Files. */
function OmpMemory({ cwd }: { cwd: string | null }) {
	const { settings, editing } = useSettingsEditing(cwd);
	return (
		<div className="mx-auto w-full max-w-5xl px-6 py-6">
			{settings.data === null ? (
				settingsReadNote(settings)
			) : (
				<OmpMemoryTab
					active
					settings={settings.data}
					editing={editing}
					onOpenFile={() => {
						location.hash = hashForSettings("files");
					}}
				/>
			)}
		</div>
	);
}

/** The omp memory, Project memory, and Bookmarks tabs. */
function ViewTabs({ tab }: { tab: MemoryRoute["tab"] }) {
	return (
		<SegmentedTabs
			value={tab}
			onValueChange={next => {
				const view = MEMORY_TABS.find(({ route }) => route.tab === next);
				if (view) location.hash = memoryHash(view.route);
			}}
			activationMode="manual"
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
