/** Settings › omp settings: omp's own settings by its tabs, searched and edited one row at a time (`OmpSettingsTab`). */
import { useRef, useState } from "react";
import type { AgentSettings } from "../../../src/shared/agent-settings";
import { searchWords } from "../../../src/shared/every-word";
import type { OmpFile } from "../../../src/shared/models";
import { cn } from "@/lib/utils";
import { ownerOf, type ShownGroup, type ShownTab, shownTabs } from "../../omp-settings";
import { hashForSettings } from "../../routing";
import { SearchField } from "../search-field";
import { type Editing, FileLink, LINK, RAIL_BUTTON, type RowContext, Section, SettingRow } from "./editor";

function Group({ group, context }: { group: ShownGroup; context: RowContext }) {
	return (
		<div className="space-y-1">
			{group.label && <h4 className="text-xs font-medium text-muted-foreground">{group.label}</h4>}
			<ul className="divide-y divide-border">
				{group.rows.map(row => (
					<SettingRow key={row.id} row={row} context={context} />
				))}
			</ul>
			{group.owned.map(({ owner, count }) => (
				<p key={owner.section} className="py-2 text-xs text-muted-foreground">
					{count === 1 ? "1 setting here is" : `${count} settings here are`} edited in{" "}
					<a href={hashForSettings(owner.section)} className={LINK}>
						{owner.label}
					</a>
					.
				</p>
			))}
		</div>
	);
}

function TabBody({ shown, context }: { shown: ShownTab; context: RowContext }) {
	return (
		<Section title={shown.tab.label}>
			{shown.groups.map(group => (
				<Group key={group.label ?? ""} group={group} context={context} />
			))}
		</Section>
	);
}

/**
 * omp's settings in its own tabs and groups, a search across them, and each row saved to your `config.yml` as you change it.
 * `configFile` and `projectFile` are the user's and the workspace's settings files Files lists, which the section links to.
 */
export function OmpSettingsTab({
	settings,
	configFile,
	projectFile,
	editing,
	onOpenFile,
}: {
	settings: AgentSettings;
	configFile: OmpFile | undefined;
	projectFile: OmpFile | undefined;
	editing: Editing;
	onOpenFile: (path: string) => void;
}) {
	const [tabId, setTabId] = useState(settings.tabs[0]?.id ?? "");
	const [query, setQuery] = useState("");
	const searching = searchWords(query).length > 0;
	const tabs = shownTabs(settings.tabs, query);
	const current = tabs.find(shown => shown.tab.id === tabId) ?? tabs[0];
	const matching = tabs.filter(shown => shown.groups.length > 0);
	const unlisted = settings.unlisted.filter(id => !ownerOf(id)).length;
	const context: RowContext = { editing, projectFile, onOpenFile };
	const rail = useRef<HTMLElement>(null);
	const body = useRef<HTMLDivElement>(null);
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<nav ref={rail} aria-label="omp settings tabs" className="space-y-4 self-start md:sticky md:top-6">
				<SearchField label="Search omp settings" placeholder="Search" query={query} onQuery={setQuery} className="min-w-0 flex-1" />
				<ul>
					{tabs.map(shown => (
						<li key={shown.tab.id}>
							<button
								type="button"
								aria-current={!searching && shown === current ? "true" : undefined}
								onClick={() => {
									setTabId(shown.tab.id);
									setQuery("");
									// The rail stays put while the rows scroll, so a tab opened below the fold starts at its top.
									const top = body.current;
									if (top && rail.current && top.getBoundingClientRect().top < rail.current.getBoundingClientRect().top) top.scrollIntoView({ block: "start" });
								}}
								className={cn(RAIL_BUTTON, !searching && shown === current && "bg-muted font-medium", searching && shown.groups.length === 0 && "text-muted-foreground opacity-60")}
							>
								<span className="truncate">{shown.tab.label}</span>
								{shown.changed > 0 && (
									<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
										{shown.changed}
										<span className="sr-only"> changed</span>
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
				{unlisted > 0 && configFile && (
					<p className="px-2 text-xs text-muted-foreground">
						{unlisted === 1 ? "1 more setting has" : `${unlisted} more settings have`} no control here.{" "}
						<FileLink file={configFile} onOpenFile={onOpenFile}>
							Edit them in config.yml
						</FileLink>
					</p>
				)}
			</nav>
			<div ref={body} className="min-w-0 scroll-mt-6 space-y-6">
				<p className="text-xs text-muted-foreground">Running sessions pick up most changes; some apply only to sessions started after the change.</p>
				{searching ? (
					matching.length === 0 ? (
						<p className="text-sm text-muted-foreground">No setting matches.</p>
					) : (
						matching.map(shown => <TabBody key={shown.tab.id} shown={shown} context={context} />)
					)
				) : (
					current && <TabBody shown={current} context={context} />
				)}
			</div>
		</div>
	);
}
