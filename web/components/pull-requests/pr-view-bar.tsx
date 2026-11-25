/**
 * The bar above the Pull requests page's list: a tab per preset of the sections it shows; **Filter**, a submenu per
 * field it filters by; **Display**, its grouping, order, empty sections, and repositories; and under them a chip per
 * filter that leaves something out.
 */
import { IconCalendar4, IconCalendarClock4, IconFolder1, IconLayersTwo, IconUser } from "central-icons";
import { repoKey, repoName } from "../../../src/shared/github";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger, MenuSwitchItem } from "@/components/ui/menu";
import {
	atLeastOneSection,
	authorOptions,
	EVERY_SECTION,
	filters,
	GROUPING_LABELS,
	GROUPINGS,
	NO_FILTER,
	PULL_REQUEST_VIEWS,
	type PullRequestDisplay,
	type PullRequestFilter,
	repoOptions,
	VIEW_PRESETS,
	viewOf,
} from "../../pull-requests-filter";
import { DEFAULT_ORDER, PULL_REQUEST_SORTS, type PullRequestSort, SORT_LABELS, sectionTitles, withRepoStepped } from "../../pull-requests-model";
import { activityControl } from "../../activity";
import { useHiddenRepos } from "../../pull-requests-state";
import { dayField, DisplayWithPanel, type FilterField, GroupingSubmenu, ListFilterBar, setField, ViewTabs } from "../list-filter-bar";
import { ShownOrderList } from "../shown-order-list";
import type { PullRequests } from "./pull-requests-list";

/** Each field of **Filter**, in menu order, from the pull requests of the repositories you did not hide. */
function useFilterFields(pulls: PullRequests, filter: PullRequestFilter, onFilter: (filter: PullRequestFilter) => void): FilterField[] {
	const [hidden] = useHiddenRepos();
	const { order, everyRepo } = pulls;
	const shownRepos = everyRepo.filter(repo => !hidden.has(repoKey(repo)));
	const set = (change: Partial<PullRequestFilter>): void => onFilter({ ...filter, ...change });
	return [
		setField({
			id: "section",
			label: "Section",
			icon: IconLayersTwo,
			control: "pull-requests.filter.section",
			noun: "sections",
			options: sectionTitles(order).map(title => ({ key: title, label: title })),
			checked: filter.sections,
			onChecked: sections => set({ sections: atLeastOneSection(sections, filter.sections) }),
			active: filter.sections.size < EVERY_SECTION.size,
			clear: () => set({ sections: EVERY_SECTION }),
			// The last shown section stays on, since the list always shows a section.
			disabled: title => filter.sections.size === 1 && filter.sections.has(title),
		}),
		setField({
			id: "repository",
			label: "Repository",
			icon: IconFolder1,
			control: "pull-requests.filter.repository",
			noun: "repositories",
			options: repoOptions(shownRepos, filter.repos),
			checked: filter.repos,
			onChecked: repos => set({ repos }),
		}),
		setField({
			id: "author",
			label: "Author",
			icon: IconUser,
			control: "pull-requests.filter.author",
			noun: "authors",
			options: authorOptions(shownRepos, filter.authors),
			checked: filter.authors,
			onChecked: authors => set({ authors }),
		}),
		dayField({ id: "created", label: "Created", icon: IconCalendar4, control: "pull-requests.filter.created", value: filter.created, onValue: created => set({ created }) }),
		dayField({ id: "updated", label: "Updated", icon: IconCalendarClock4, control: "pull-requests.filter.updated", value: filter.updated, onValue: updated => set({ updated }) }),
	];
}

/** The repositories, each with a switch that hides it and buttons that move it among all of them, so a hidden one can move too. */
function RepositoriesPanel({ pulls }: { pulls: PullRequests }) {
	const [hidden, toggleHidden] = useHiddenRepos();
	const { everyRepo, order, setOrder } = pulls;
	const rows = everyRepo.map(repo => {
		const key = repoKey(repo);
		return { key, label: repoName(repo), shown: !hidden.has(key) };
	});
	const keys = rows.map(({ key }) => key);
	return (
		<ShownOrderList
			rows={rows}
			onShow={key => toggleHidden(key)}
			onMove={(key, by) => {
				const next = withRepoStepped(order, keys, keys, key, by);
				if (next) setOrder(next);
			}}
			controls={{ show: "pull-requests.repository.toggle", move: "pull-requests.repository.move" }}
		/>
	);
}

/**
 * **Display**: the grouping, the order, whether empty sections show, and **Repositories…**, which opens a popover under
 * the same button that hides repositories and changes their order.
 */
function DisplayMenu({ pulls, display, onDisplay }: { pulls: PullRequests; display: PullRequestDisplay; onDisplay: (display: PullRequestDisplay) => void }) {
	const [hidden] = useHiddenRepos();
	const { order, onSort, onReset, everyRepo } = pulls;
	const hiddenCount = everyRepo.filter(repo => hidden.has(repoKey(repo))).length;
	const label = hiddenCount === 0 ? "Display" : `Display: ${hiddenCount} ${hiddenCount === 1 ? "repository" : "repositories"} hidden`;
	return (
		<DisplayWithPanel
			label={label}
			control="pull-requests.display"
			active={hiddenCount > 0}
			menu={openPanel => (
				<>
					<GroupingSubmenu groupings={GROUPINGS} labels={GROUPING_LABELS} value={display.grouping} control="pull-requests.display.grouping" onValue={grouping => onDisplay({ ...display, grouping })} />
					<MenuSubmenu>
						<MenuSubmenuTrigger value={SORT_LABELS[order.sort]}>Ordering</MenuSubmenuTrigger>
						<MenuSubmenuContent className="w-52">
							<MenuRadioGroup value={order.sort} onValueChange={(sort: PullRequestSort) => onSort(sort)}>
								{PULL_REQUEST_SORTS.map(sort => (
									<MenuRadioItem key={sort} value={sort} closeOnSelect>
										{SORT_LABELS[sort]}
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
							<MenuSeparator />
							<MenuItem disabled={JSON.stringify(order) === JSON.stringify(DEFAULT_ORDER)} onClick={onReset}>
								Reset the order
							</MenuItem>
						</MenuSubmenuContent>
					</MenuSubmenu>
					<MenuSwitchItem {...activityControl("pull-requests.display.empty")} checked={display.empty} closeOnSelect={false} onCheckedChange={empty => onDisplay({ ...display, empty })}>
						Show empty sections
					</MenuSwitchItem>
					{everyRepo.length > 0 && (
						<>
							<MenuSeparator />
							<MenuItem {...activityControl("pull-requests.repositories")} onClick={openPanel}>
								Repositories…
								{hiddenCount > 0 && <span className="ml-auto pl-4 text-xs text-muted-foreground">{hiddenCount} hidden</span>}
							</MenuItem>
						</>
					)}
				</>
			)}
			title="Repositories"
			description="Hidden repositories also leave the tab's count. Saved in this browser."
			panelClassName="w-96"
		>
			<RepositoriesPanel pulls={pulls} />
		</DisplayWithPanel>
	);
}

interface PullRequestViewBarProps {
	pulls: PullRequests;
	filter: PullRequestFilter;
	onFilter: (filter: PullRequestFilter) => void;
	display: PullRequestDisplay;
	onDisplay: (display: PullRequestDisplay) => void;
}

/** The tabs, **Filter** and **Display** at the end of their row, and under them a chip per filter that leaves something out. */
export function PullRequestViewBar({ pulls, filter, onFilter, display, onDisplay }: PullRequestViewBarProps) {
	const fields = useFilterFields(pulls, filter, onFilter);
	return (
		<ListFilterBar
			tabs={
				<ViewTabs
					views={PULL_REQUEST_VIEWS}
					labelOf={view => VIEW_PRESETS[view].label}
					picked={viewOf(filter.sections)}
					control="pull-requests.view"
					onPick={view => onFilter({ ...filter, sections: VIEW_PRESETS[view].sections })}
				/>
			}
			fields={fields}
			filtering={filters(filter)}
			controls={{ filter: "pull-requests.filter", clear: "pull-requests.filter.clear" }}
			onClearAll={() => onFilter(NO_FILTER)}
			display={<DisplayMenu pulls={pulls} display={display} onDisplay={onDisplay} />}
		/>
	);
}
