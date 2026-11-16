/**
 * The bar above the Pull requests page's list: a tab per preset of the sections it shows; **Filter**, a submenu per
 * field it filters by; **Display**, its grouping, order, empty sections, and repositories; and under them a chip per
 * filter that leaves something out.
 */
import { IconCalendar4, IconCalendarClock4, IconCrossMedium, IconFilter1, IconFolder1, IconLayersTwo, IconSettingsSliderHor, IconUser } from "central-icons";
import { type ComponentType, type ReactNode, useId, useRef, useState } from "react";
import { repoKey, repoName } from "../../../src/shared/github";
import type { ControlId as ActivityControlId } from "../../../src/shared/activity";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuCheckItem, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger, MenuSwitchItem } from "@/components/ui/menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import {
	DAY_RANGES,
	type DayRange,
	EVERY_SECTION,
	filters,
	GROUPINGS,
	NO_FILTER,
	PULL_REQUEST_VIEWS,
	type PullRequestFilter,
	type PullRequestGrouping,
	type PullRequestView,
	viewOf,
	withSectionToggled,
	withToggled,
} from "../../pull-requests-filter";
import { DEFAULT_ORDER, listedPullRequests, PULL_REQUEST_SORTS, type PullRequestSort, sectionTitles, withRepoStepped } from "../../pull-requests-model";
import { activityControl } from "../../activity";
import { useHiddenRepos, usePullRequestsDisplay, usePullRequestsFilter } from "../../pull-requests-state";
import { ShownOrderList } from "../shown-order-list";
import type { PullRequests } from "./pull-requests-list";

const VIEWS = Object.keys(PULL_REQUEST_VIEWS) as PullRequestView[];
const GROUPING_IDS = Object.keys(GROUPINGS) as PullRequestGrouping[];
const SORTS = Object.keys(PULL_REQUEST_SORTS) as PullRequestSort[];
const DAY_RANGE_IDS = Object.keys(DAY_RANGES).map(Number) as DayRange[];

/** One field **Filter** filters by: its submenu's rows, and what its chip says while it leaves something out. */
interface FilterField {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	control: ActivityControlId;
	/** Whether it leaves something out, which shows its chip. */
	active: boolean;
	/** `is`, `is either of`, or `in`. */
	verb: string;
	/** What it keeps, short, such as `3 sections`, and in full for the chip's tooltip. */
	value: string;
	full: string;
	clear: () => void;
	items: ReactNode;
}

/** The phrase of a set of `names`: the name of one, or how many of `noun`. */
const setValue = (names: string[], noun: string): string => (names.length === 1 ? names[0]! : `${names.length} ${noun}`);

/** A check per value of `values`, whose `checked` keeps them; checking one leaves the menu open, so you can check several. */
function checkItems(values: { key: string; label: string; hint?: string }[], checked: ReadonlySet<string>, control: ActivityControlId, onToggle: (key: string) => void, disabled?: (key: string) => boolean): ReactNode {
	return values.map(({ key, label, hint }) => (
		<MenuCheckItem {...activityControl(control)} key={key} checked={checked.has(key)} disabled={disabled?.(key)} closeOnClick={false} onCheckedChange={() => onToggle(key)}>
			<span className="truncate">{label}</span>
			{hint && <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{hint}</span>}
		</MenuCheckItem>
	));
}

/** **Any time** and each {@link DayRange}, one picked. */
function dayItems(value: DayRange | null, control: ActivityControlId, onValue: (value: DayRange | null) => void): ReactNode {
	return (
		<MenuRadioGroup value={value === null ? "any" : String(value)} onValueChange={(next: string) => onValue(next === "any" ? null : (Number(next) as DayRange))}>
			<MenuRadioItem {...activityControl(control)} value="any" closeOnClick>
				Any time
			</MenuRadioItem>
			{DAY_RANGE_IDS.map(days => (
				<MenuRadioItem {...activityControl(control)} key={days} value={String(days)} closeOnClick>
					{DAY_RANGES[days]}
				</MenuRadioItem>
			))}
		</MenuRadioGroup>
	);
}

/** Each field of **Filter**, in menu order, from the pull requests of the repositories you did not hide. */
function useFilterFields(pulls: PullRequests): { filter: PullRequestFilter; setFilter: (filter: PullRequestFilter) => void; fields: FilterField[] } {
	const [filter, setFilter] = usePullRequestsFilter();
	const [hidden] = useHiddenRepos();
	const { order, everyRepo } = pulls;
	const shownRepos = everyRepo.filter(repo => !hidden.has(repoKey(repo)) || filter.repos.has(repoKey(repo)));
	const counts = new Map<string, number>();
	for (const pr of listedPullRequests(shownRepos)) counts.set(pr.author.login, (counts.get(pr.author.login) ?? 0) + 1);
	for (const login of filter.authors) if (!counts.has(login)) counts.set(login, 0);
	const authors = [...counts].toSorted(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b));
	const titles = sectionTitles(order);
	const shownTitles = titles.filter(title => filter.sections.has(title));
	const repoNames = shownRepos.filter(repo => filter.repos.has(repoKey(repo))).map(repoName);
	const set = (change: Partial<PullRequestFilter>): void => setFilter({ ...filter, ...change });
	const day = (id: "created" | "since", label: string, icon: FilterField["icon"], control: ActivityControlId): FilterField => {
		const value = filter[id];
		return { id, label, icon, control, active: value !== null, verb: "in the", value: value === null ? "Any time" : DAY_RANGES[value].toLowerCase(), full: "", clear: () => set({ [id]: null }), items: dayItems(value, control, next => set({ [id]: next })) };
	};
	return {
		filter,
		setFilter,
		fields: [
			{
				id: "section",
				label: "Section",
				icon: IconLayersTwo,
				control: "pull-requests.filter.section",
				active: filter.sections.size < EVERY_SECTION.size,
				verb: shownTitles.length === 1 ? "is" : "is any of",
				value: setValue(shownTitles, "sections"),
				full: shownTitles.join(", "),
				clear: () => set({ sections: EVERY_SECTION }),
				// The last shown section stays on, since the list always shows a section.
				items: checkItems(
					titles.map(title => ({ key: title, label: title })),
					filter.sections,
					"pull-requests.filter.section",
					title => set({ sections: withSectionToggled(filter.sections, title as never) }),
					title => filter.sections.size === 1 && filter.sections.has(title as never),
				),
			},
			{
				id: "repository",
				label: "Repository",
				icon: IconFolder1,
				control: "pull-requests.filter.repository",
				active: filter.repos.size > 0,
				verb: repoNames.length === 1 ? "is" : "is any of",
				value: setValue(repoNames, "repositories"),
				full: repoNames.join(", "),
				clear: () => set({ repos: new Set() }),
				items: checkItems(
					shownRepos.map(repo => ({ key: repoKey(repo), label: repoName(repo) })),
					filter.repos,
					"pull-requests.filter.repository",
					key => set({ repos: withToggled(filter.repos, key) }),
				),
			},
			{
				id: "author",
				label: "Author",
				icon: IconUser,
				control: "pull-requests.filter.author",
				active: filter.authors.size > 0,
				verb: filter.authors.size === 1 ? "is" : "is any of",
				value: setValue([...filter.authors], "authors"),
				full: [...filter.authors].join(", "),
				clear: () => set({ authors: new Set() }),
				items: checkItems(
					authors.map(([login, count]) => ({ key: login, label: login, hint: String(count) })),
					filter.authors,
					"pull-requests.filter.author",
					login => set({ authors: withToggled(filter.authors, login) }),
				),
			},
			day("created", "Created", IconCalendar4, "pull-requests.filter.created"),
			day("since", "Updated", IconCalendarClock4, "pull-requests.filter.since"),
		],
	};
}

/** `Field · verb · value · ×`: what a filter keeps, whose value reopens its rows and whose × removes it. */
function FilterChip({ field }: { field: FilterField }) {
	const { label, icon: Icon, verb, value, full, clear, items } = field;
	const [open, setOpen] = useState(false);
	const cell = "flex items-center px-2";
	const pressable = "outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:ring-inset";
	return (
		<div role="group" aria-label={`Filter: ${label}`} className="inline-flex h-7 items-stretch divide-x divide-border overflow-hidden rounded-md border border-border bg-popover text-xs">
			<span className={`${cell} gap-1.5 font-medium`}>
				<Icon className="size-3.5 text-muted-foreground" />
				{label}
			</span>
			<span className={`${cell} text-muted-foreground`}>{verb}</span>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<Tooltip content={full || value} forceOpen={open ? false : undefined}>
					<DropdownMenuTrigger render={<button type="button" className={`${cell} font-medium ${pressable}`} />}>{value}</DropdownMenuTrigger>
				</Tooltip>
				<DropdownMenuContent align="start" className="w-56">
					{items}
				</DropdownMenuContent>
			</DropdownMenu>
			<Tooltip content={`Remove the ${label.toLowerCase()} filter`}>
				<button {...activityControl("pull-requests.filter.clear")} type="button" aria-label={`Remove the ${label.toLowerCase()} filter`} className={`${cell} text-muted-foreground hover:text-foreground ${pressable}`} onClick={clear}>
					<IconCrossMedium aria-hidden className="size-3" />
				</button>
			</Tooltip>
		</div>
	);
}

/** **Filter**: a submenu per field, each naming what it keeps while it leaves something out. */
function FilterMenu({ fields, active }: { fields: FilterField[]; active: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content="Filter" forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button {...activityControl("pull-requests.filter")} variant="outline" size="icon-compact" aria-label="Filter" active={active} />}>
					<IconFilter1 />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-56">
				{fields.map(({ id, label, icon: Icon, active, value, items }) => (
					<MenuSubmenu key={id}>
						<MenuSubmenuTrigger value={active ? value : undefined}>
							<Icon />
							{label}
						</MenuSubmenuTrigger>
						<MenuSubmenuContent className="w-56">{items}</MenuSubmenuContent>
					</MenuSubmenu>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
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
					<DropdownMenu open={menu} onOpenChange={setMenu}>
						<Tooltip content={label} forceOpen={menu || repositories ? false : undefined}>
							<DropdownMenuTrigger
								render={<Button ref={button} {...activityControl("pull-requests.display")} variant="outline" size="icon-compact" aria-label={label} active={repositories || hiddenCount > 0} />}
							>
								<IconSettingsSliderHor />
							</DropdownMenuTrigger>
						</Tooltip>
						<DropdownMenuContent align="end" className="w-72">
							<MenuSubmenu>
								<MenuSubmenuTrigger value={GROUPINGS[display.grouping]}>Grouping</MenuSubmenuTrigger>
								<MenuSubmenuContent className="w-48">
									<MenuRadioGroup value={display.grouping} onValueChange={(grouping: PullRequestGrouping) => setDisplay({ ...display, grouping })}>
										{GROUPING_IDS.map(grouping => (
											<MenuRadioItem {...activityControl("pull-requests.display.grouping")} key={grouping} value={grouping} closeOnClick>
												{GROUPINGS[grouping]}
											</MenuRadioItem>
										))}
									</MenuRadioGroup>
								</MenuSubmenuContent>
							</MenuSubmenu>
							<MenuSubmenu>
								<MenuSubmenuTrigger value={PULL_REQUEST_SORTS[order.sort]}>Ordering</MenuSubmenuTrigger>
								<MenuSubmenuContent className="w-52">
									<MenuRadioGroup value={order.sort} onValueChange={(sort: PullRequestSort) => onSort(sort)}>
										{SORTS.map(sort => (
											<MenuRadioItem key={sort} value={sort} closeOnClick>
												{PULL_REQUEST_SORTS[sort]}
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
						</DropdownMenuContent>
					</DropdownMenu>
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
	const view = viewOf(filter.sections);
	const chips = fields.filter(({ active }) => active);
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<div role="group" aria-label="View" className="flex min-w-0 flex-wrap gap-1.5">
					{VIEWS.map(each => (
						<Button
							{...activityControl("pull-requests.view")}
							key={each}
							variant="tertiary"
							size="compact"
							active={each === view}
							aria-pressed={each === view}
							onClick={() => setFilter({ ...filter, sections: PULL_REQUEST_VIEWS[each].sections })}
						>
							{PULL_REQUEST_VIEWS[each].label}
						</Button>
					))}
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<FilterMenu fields={fields} active={filters(filter)} />
					<DisplayMenu pulls={pulls} />
				</div>
			</div>
			{chips.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{chips.map(field => (
						<FilterChip key={field.id} field={field} />
					))}
					{chips.length > 1 && (
						<Button {...activityControl("pull-requests.filter.clear")} variant="ghost" size="compact" className="text-muted-foreground" onClick={() => setFilter(NO_FILTER)}>
							Clear all
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
