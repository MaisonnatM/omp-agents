/**
 * The bar above the Pull requests page's list: a tab per preset of the sections it shows; **Filter**, a submenu per
 * field it filters by; **Display**, its grouping, order, empty sections, and repositories; and under them a chip per
 * filter that leaves something out.
 */
import { IconCalendar4, IconCalendarClock4, IconFolder1, IconLayersTwo, IconUser } from "central-icons";
import { useId, useRef, useState } from "react";
import { repoKey, repoName } from "../../../src/shared/github";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger, MenuSwitchItem } from "@/components/ui/menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { withToggled } from "../../list-filter";
import {
	authorOptions,
	EVERY_SECTION,
	filters,
	GROUPING_LABELS,
	GROUPINGS,
	NO_FILTER,
	PULL_REQUEST_VIEWS,
	type PullRequestFilter,
	type PullRequestGrouping,
	repoOptions,
	VIEW_PRESETS,
	viewOf,
	withSectionToggled,
} from "../../pull-requests-filter";
import { DEFAULT_ORDER, PULL_REQUEST_SORTS, type PullRequestSort, SORT_LABELS, sectionTitles, withRepoStepped } from "../../pull-requests-model";
import { activityControl } from "../../activity";
import { useHiddenRepos, usePullRequestsDisplay, usePullRequestsFilter } from "../../pull-requests-state";
import { DisplayButton, dayField, FilterChips, type FilterField, FilterMenu, setField, ViewTabs } from "../list-filter-bar";
import { ShownOrderList } from "../shown-order-list";
import type { PullRequests } from "./pull-requests-list";


/** Each field of **Filter**, in menu order, from the pull requests of the repositories you did not hide. */
function useFilterFields(pulls: PullRequests): { filter: PullRequestFilter; setFilter: (filter: PullRequestFilter) => void; fields: FilterField[] } {
	const [filter, setFilter] = usePullRequestsFilter();
	const [hidden] = useHiddenRepos();
	const { order, everyRepo } = pulls;
	const shownRepos = everyRepo.filter(repo => !hidden.has(repoKey(repo)));
	const set = (change: Partial<PullRequestFilter>): void => setFilter({ ...filter, ...change });
	return {
		filter,
		setFilter,
		fields: [
			setField({
				id: "section",
				label: "Section",
				icon: IconLayersTwo,
				control: "pull-requests.filter.section",
				noun: "sections",
				options: sectionTitles(order).map(title => ({ key: title, label: title })),
				checked: filter.sections,
				active: filter.sections.size < EVERY_SECTION.size,
				onToggle: title => set({ sections: withSectionToggled(filter.sections, title) }),
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
				active: filter.repos.size > 0,
				onToggle: key => set({ repos: withToggled(filter.repos, key) }),
				clear: () => set({ repos: new Set() }),
			}),
			setField({
				id: "author",
				label: "Author",
				icon: IconUser,
				control: "pull-requests.filter.author",
				noun: "authors",
				options: authorOptions(shownRepos, filter.authors),
				checked: filter.authors,
				active: filter.authors.size > 0,
				onToggle: login => set({ authors: withToggled(filter.authors, login) }),
				clear: () => set({ authors: new Set() }),
			}),
			dayField({ id: "created", label: "Created", icon: IconCalendar4, control: "pull-requests.filter.created", value: filter.created, onValue: created => set({ created }) }),
			dayField({ id: "updated", label: "Updated", icon: IconCalendarClock4, control: "pull-requests.filter.updated", value: filter.updated, onValue: updated => set({ updated }) }),
		],
	};
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
function DisplayMenu({ pulls }: { pulls: PullRequests }) {
	const [display, setDisplay] = usePullRequestsDisplay();
	const [hidden] = useHiddenRepos();
	const [repositories, setRepositories] = useState(false);
	const [menu, setMenu] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const { order, onSort, onReset, everyRepo } = pulls;
	const hiddenCount = everyRepo.filter(repo => hidden.has(repoKey(repo))).length;
	const label = hiddenCount === 0 ? "Display" : `Display: ${hiddenCount} ${hiddenCount === 1 ? "repository" : "repositories"} hidden`;
	return (
		<Popover open={repositories} onOpenChange={setRepositories}>
			<PopoverAnchor asChild>
				<span className="inline-flex">
					<DisplayButton
						label={label}
						control="pull-requests.display"
						active={repositories || hiddenCount > 0}
						open={menu}
						onOpenChange={setMenu}
						tooltipHidden={repositories}
						buttonRef={button}
					>
							<MenuSubmenu>
								<MenuSubmenuTrigger value={GROUPING_LABELS[display.grouping]}>Grouping</MenuSubmenuTrigger>
								<MenuSubmenuContent className="w-48">
									<MenuRadioGroup value={display.grouping} onValueChange={(grouping: PullRequestGrouping) => setDisplay({ ...display, grouping })}>
										{GROUPINGS.map(grouping => (
											<MenuRadioItem {...activityControl("pull-requests.display.grouping")} key={grouping} value={grouping} closeOnClick>
												{GROUPING_LABELS[grouping]}
											</MenuRadioItem>
										))}
									</MenuRadioGroup>
								</MenuSubmenuContent>
							</MenuSubmenu>
							<MenuSubmenu>
								<MenuSubmenuTrigger value={SORT_LABELS[order.sort]}>Ordering</MenuSubmenuTrigger>
								<MenuSubmenuContent className="w-52">
									<MenuRadioGroup value={order.sort} onValueChange={(sort: PullRequestSort) => onSort(sort)}>
										{PULL_REQUEST_SORTS.map(sort => (
											<MenuRadioItem key={sort} value={sort} closeOnClick>
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
							<MenuSwitchItem {...activityControl("pull-requests.display.empty")} checked={display.empty} closeOnClick={false} onCheckedChange={empty => setDisplay({ ...display, empty })}>
								Show empty sections
							</MenuSwitchItem>
							{everyRepo.length > 0 && (
								<>
									<MenuSeparator />
									<MenuItem {...activityControl("pull-requests.repositories")} onClick={() => setRepositories(true)}>
										Repositories…
										{hiddenCount > 0 && <span className="ml-auto pl-4 text-xs text-muted-foreground">{hiddenCount} hidden</span>}
									</MenuItem>
								</>
							)}
					</DisplayButton>
				</span>
			</PopoverAnchor>
			<PopoverContent
				align="end"
				collisionPadding={8}
				aria-labelledby={titleId}
				// With no trigger of its own, the popover hands focus back to **Display** as it closes.
				onCloseAutoFocus={event => {
					event.preventDefault();
					button.current?.focus();
				}}
				className="max-h-(--radix-popover-content-available-height) w-96 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto p-3"
			>
				<PopoverHeader>
					<PopoverTitle id={titleId} className="text-sm">
						Repositories
					</PopoverTitle>
					<PopoverDescription className="text-xs">Hidden repositories also leave the tab's count. Saved in this browser.</PopoverDescription>
				</PopoverHeader>
				<RepositoriesPanel pulls={pulls} />
			</PopoverContent>
		</Popover>
	);
}

/** The tabs, **Filter** and **Display** at the end of their row, and under them a chip per filter that leaves something out. */
export function PullRequestViewBar({ pulls }: { pulls: PullRequests }) {
	const { filter, setFilter, fields } = useFilterFields(pulls);
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<ViewTabs
					views={PULL_REQUEST_VIEWS}
					labelOf={view => VIEW_PRESETS[view].label}
					picked={viewOf(filter.sections)}
					control="pull-requests.view"
					onPick={view => setFilter({ ...filter, sections: VIEW_PRESETS[view].sections })}
				/>
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<FilterMenu fields={fields} active={filters(filter)} control="pull-requests.filter" />
					<DisplayMenu pulls={pulls} />
				</div>
			</div>
			<FilterChips fields={fields} clearControl="pull-requests.filter.clear" onClearAll={() => setFilter(NO_FILTER)} />
		</div>
	);
}
