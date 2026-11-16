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
	authorOptions,
	DAY_RANGE_LABELS,
	DAY_RANGES,
	type DayRange,
	EVERY_SECTION,
	type FilterOption,
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
	withToggled,
} from "../../pull-requests-filter";
import { DEFAULT_ORDER, PULL_REQUEST_SORTS, type PullRequestSort, SORT_LABELS, sectionTitles, withRepoStepped } from "../../pull-requests-model";
import { activityControl } from "../../activity";
import { useHiddenRepos, usePullRequestsDisplay, usePullRequestsFilter } from "../../pull-requests-state";
import { ShownOrderList } from "../shown-order-list";
import type { PullRequests } from "./pull-requests-list";

/** One field **Filter** filters by: its submenu's rows, and what its chip says while it leaves something out. */
interface FilterField {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	/** Whether it leaves something out, which shows its chip. */
	active: boolean;
	/** `is`, `is any of`, or `in the`. */
	verb: string;
	/** What it keeps, short, such as `3 sections`. */
	value: string;
	/** Every value it keeps, for the chip's tooltip; `null` where `value` says it all. */
	full: string | null;
	clear: () => void;
	items: ReactNode;
}

/** What every field of **Filter** has before its values: its id, its name, its icon, and the activity control of its rows. */
interface FieldBase {
	id: string;
	label: string;
	icon: FilterField["icon"];
	control: ActivityControlId;
}

/** A check per option, whose `checked` keeps them, with its count where it has one; checking one leaves the menu open, so you can check several. */
function checkItems<K extends string>(options: readonly FilterOption<K>[], checked: ReadonlySet<K>, control: ActivityControlId, onToggle: (key: K) => void, disabled?: (key: K) => boolean): ReactNode {
	return options.map(({ key, label, count }) => (
		<MenuCheckItem {...activityControl(control)} key={key} checked={checked.has(key)} disabled={disabled?.(key)} closeOnClick={false} onCheckedChange={() => onToggle(key)}>
			<span className="truncate">{label}</span>
			{count !== undefined && <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{count}</span>}
		</MenuCheckItem>
	));
}

/** A field that keeps the pull requests whose value is any of `checked`, of its `options`; its chip names one, or counts several of `noun`. */
function setField<K extends string>({
	id,
	label,
	icon,
	control,
	noun,
	options,
	checked,
	active,
	onToggle,
	clear,
	disabled,
}: FieldBase & {
	noun: string;
	options: readonly FilterOption<K>[];
	checked: ReadonlySet<K>;
	active: boolean;
	onToggle: (key: K) => void;
	clear: () => void;
	disabled?: (key: K) => boolean;
}): FilterField {
	const names = options.filter(({ key }) => checked.has(key)).map(option => option.label);
	return {
		id,
		label,
		icon,
		active,
		verb: names.length === 1 ? "is" : "is any of",
		value: names.length === 1 ? names[0]! : `${names.length} ${noun}`,
		full: names.join(", "),
		clear,
		items: checkItems(options, checked, control, onToggle, disabled),
	};
}

/** A field that keeps the pull requests of the last {@link DayRange} by one of their dates, with **Any time** first, one picked. */
function dayField({ id, label, icon, control, value, onValue }: FieldBase & { value: DayRange | null; onValue: (value: DayRange | null) => void }): FilterField {
	return {
		id,
		label,
		icon,
		active: value !== null,
		verb: "in the",
		value: value === null ? "Any time" : DAY_RANGE_LABELS[value].toLowerCase(),
		full: null,
		clear: () => onValue(null),
		items: (
			<MenuRadioGroup value={value === null ? "any" : String(value)} onValueChange={(next: string) => onValue(DAY_RANGES.find(days => String(days) === next) ?? null)}>
				<MenuRadioItem {...activityControl(control)} value="any" closeOnClick>
					Any time
				</MenuRadioItem>
				{DAY_RANGES.map(days => (
					<MenuRadioItem {...activityControl(control)} key={days} value={String(days)} closeOnClick>
						{DAY_RANGE_LABELS[days]}
					</MenuRadioItem>
				))}
			</MenuRadioGroup>
		),
	};
}

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
				<Tooltip content={full ?? value} forceOpen={open ? false : undefined}>
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
					{PULL_REQUEST_VIEWS.map(each => (
						<Button
							{...activityControl("pull-requests.view")}
							key={each}
							variant="tertiary"
							size="compact"
							active={each === view}
							aria-pressed={each === view}
							onClick={() => setFilter({ ...filter, sections: VIEW_PRESETS[each].sections })}
						>
							{VIEW_PRESETS[each].label}
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
