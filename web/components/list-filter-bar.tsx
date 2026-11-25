/**
 * A list page's bar, whatever it lists: its view tabs, **Filter** with a submenu per field, the chip per filter that
 * leaves something out with **Clear all**, and the **Display** button with its grouping and the panel it can open; and
 * what the list shows while the search or **Filter** keep nothing.
 */
import { IconCrossMedium, IconFilter1, IconSettingsSliderHor } from "central-icons";
import { type ComponentType, type ReactNode, type Ref, type RefObject, useRef, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuCheckItem, MenuRadioGroup, MenuRadioItem, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { DAY_RANGE_LABELS, DAY_RANGES, type DayRange, type FilterOption, withToggled } from "../list-filter";

/** One field **Filter** filters by: its submenu's rows, and what its chip says while it leaves something out. */
export interface FilterField {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	/** Whether it leaves something out, which shows its chip. */
	active: boolean;
	/** Whether **Filter** lists it: a field with no value to check is left out, so its submenu never opens empty. */
	offered: boolean;
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
	control: ControlId;
}

/**
 * A field that keeps the items whose value is any of `checked`, of its `options`, each check flipping one; its chip
 * names one, or counts several of `noun`. It leaves something out while any is checked, and clearing it unchecks them
 * all, unless `active` and `clear` say otherwise; `disabled` keeps a check as it is.
 */
export function setField<K extends string>({
	id,
	label,
	icon,
	control,
	noun,
	options,
	checked,
	onChecked,
	active = checked.size > 0,
	clear = () => onChecked(new Set()),
	disabled,
}: FieldBase & {
	noun: string;
	options: readonly FilterOption<K>[];
	checked: ReadonlySet<K>;
	onChecked: (checked: ReadonlySet<K>) => void;
	active?: boolean;
	clear?: () => void;
	disabled?: (key: K) => boolean;
}): FilterField {
	const names = options.filter(({ key }) => checked.has(key)).map(option => option.label);
	return {
		id,
		label,
		icon,
		active,
		offered: options.length > 0,
		verb: names.length === 1 ? "is" : "is any of",
		value: names.length === 1 ? names[0]! : `${names.length} ${noun}`,
		full: names.join(", "),
		clear,
		// Checking one leaves the menu open, so you can check several.
		items: options.map(({ key, label, count }) => (
			<MenuCheckItem {...activityControl(control)} key={key} checked={checked.has(key)} disabled={disabled?.(key)} closeOnSelect={false} onCheckedChange={() => onChecked(withToggled(checked, key))}>
				<span className="truncate">{label}</span>
				{count !== undefined && <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{count}</span>}
			</MenuCheckItem>
		)),
	};
}

/**
 * A field that keeps the items within one {@link DayRange} by one of their dates, with **Any time** first, one picked.
 * `labels` name the ranges, the last ones by default, and its chip reads `verb`, `in the` by default, then the label.
 */
export function dayField({
	id,
	label,
	icon,
	control,
	value,
	onValue,
	verb = "in the",
	labels = DAY_RANGE_LABELS,
}: FieldBase & { value: DayRange | null; onValue: (value: DayRange | null) => void; verb?: string; labels?: Record<DayRange, string> }): FilterField {
	return {
		id,
		label,
		icon,
		active: value !== null,
		offered: true,
		verb,
		value: value === null ? "Any time" : labels[value].toLowerCase(),
		full: null,
		clear: () => onValue(null),
		items: (
			<MenuRadioGroup value={value === null ? "any" : String(value)} onValueChange={(next: string) => onValue(DAY_RANGES.find(days => String(days) === next) ?? null)}>
				<MenuRadioItem {...activityControl(control)} value="any" closeOnSelect>
					Any time
				</MenuRadioItem>
				{DAY_RANGES.map(days => (
					<MenuRadioItem {...activityControl(control)} key={days} value={String(days)} closeOnSelect>
						{labels[days]}
					</MenuRadioItem>
				))}
			</MenuRadioGroup>
		),
	};
}

/** `Field · verb · value · ×`: what a filter keeps, whose value reopens its rows and whose ×, with `clearControl`, calls `onRemove`. */
function FilterChip({ field, clearControl, onRemove }: { field: FilterField; clearControl: ControlId; onRemove: (button: HTMLButtonElement) => void }) {
	const { label, icon: Icon, verb, value, full, items } = field;
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
				<button
					{...activityControl(clearControl)}
					type="button"
					data-filter-remove
					aria-label={`Remove the ${label.toLowerCase()} filter`}
					className={`${cell} text-muted-foreground hover:text-foreground ${pressable}`}
					onClick={event => onRemove(event.currentTarget)}
				>
					<IconCrossMedium aria-hidden className="size-3" />
				</button>
			</Tooltip>
		</div>
	);
}

/** **Filter**: the icon button, marked while `active`, whose menu has a submenu per offered field, each naming what it keeps while it leaves something out. */
function FilterMenu({ fields, active, control, triggerRef }: { fields: readonly FilterField[]; active: boolean; control: ControlId; triggerRef: Ref<HTMLButtonElement> }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content="Filter" forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button ref={triggerRef} {...activityControl(control)} variant="outline" size="icon-compact" aria-label="Filter" active={active} />}>
					<IconFilter1 />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-56">
				{fields
					.filter(({ offered }) => offered)
					.map(({ id, label, icon: Icon, active, value, items }) => (
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

/**
 * The row of chips under the bar, one per field that leaves something out, and **Clear all** once there are two;
 * nothing while no field does. `clearControl` is the activity control of each × and of **Clear all**. Removing a chip
 * hands focus to the next chip's ×, or the one before, and **Clear all** or the last chip's × to `filterRef`, **Filter**.
 */
function FilterChips({ fields, clearControl, onClearAll, filterRef }: { fields: readonly FilterField[]; clearControl: ControlId; onClearAll: () => void; filterRef: RefObject<HTMLButtonElement | null> }) {
	const row = useRef<HTMLDivElement>(null);
	const chips = fields.filter(({ active }) => active);
	if (chips.length === 0) return null;
	const remove = (field: FilterField, button: HTMLButtonElement): void => {
		const removes = [...(row.current?.querySelectorAll<HTMLButtonElement>("[data-filter-remove]") ?? [])];
		const at = removes.indexOf(button);
		(removes[at + 1] ?? removes[at - 1] ?? filterRef.current)?.focus();
		field.clear();
	};
	return (
		<div ref={row} className="flex flex-wrap items-center gap-1.5">
			{chips.map(field => (
				<FilterChip key={field.id} field={field} clearControl={clearControl} onRemove={button => remove(field, button)} />
			))}
			{chips.length > 1 && (
				<Button
					{...activityControl(clearControl)}
					variant="ghost"
					size="compact"
					className="text-muted-foreground"
					onClick={() => {
						filterRef.current?.focus();
						onClearAll();
					}}
				>
					Clear all
				</Button>
			)}
		</div>
	);
}

/** The tabs above a list, a pressed button per view in `views` order, `picked` pressed; `null` presses none, as for a filter that matches no view. */
export function ViewTabs<V extends string>({ views, labelOf, picked, control, onPick }: { views: readonly V[]; labelOf: (view: V) => string; picked: V | null; control: ControlId; onPick: (view: V) => void }) {
	return (
		<div role="group" aria-label="View" className="flex min-w-0 flex-wrap gap-1.5">
			{views.map(view => (
				<Button {...activityControl(control)} key={view} variant="tertiary" size="compact" active={view === picked} aria-pressed={view === picked} onClick={() => onPick(view)}>
					{labelOf(view)}
				</Button>
			))}
		</div>
	);
}

/**
 * **Display**: the sliders icon button, marked while `active`, whose menu is `children`. Its tooltip, `label`, hides
 * while the menu is open or while `tooltipHidden`, such as while a panel it opened is up; `buttonRef` reaches the
 * button, to hand focus back to it.
 */
export function DisplayButton({
	label,
	control,
	active,
	tooltipHidden = false,
	buttonRef,
	menuClassName = "w-72",
	children,
}: {
	label: string;
	control: ControlId;
	active: boolean;
	tooltipHidden?: boolean;
	buttonRef?: Ref<HTMLButtonElement>;
	menuClassName?: string;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content={label} forceOpen={open || tooltipHidden ? false : undefined}>
				<DropdownMenuTrigger render={<Button ref={buttonRef} {...activityControl(control)} variant="outline" size="icon-compact" aria-label={label} active={active} />}>
					<IconSettingsSliderHor />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className={menuClassName}>
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * {@link DisplayButton} with a panel it opens, such as **Repositories…**: `menu` gets the function that opens it, a
 * popover under the same button, `title` over `description` then `children`, which unmount as it closes, and which
 * hands focus back to **Display**. The button is marked while `active` or while the panel is up; `escapeKeepsOpen`
 * can keep the panel open on Esc, given the element Esc was pressed in.
 */
export function DisplayWithPanel({
	label,
	control,
	active,
	menu,
	title,
	description,
	panelClassName,
	escapeKeepsOpen,
	children,
}: {
	label: string;
	control: ControlId;
	active: boolean;
	menu: (openPanel: () => void) => ReactNode;
	title: string;
	description: string;
	/** The panel's width, such as `w-96`. */
	panelClassName: string;
	escapeKeepsOpen?: (target: EventTarget | null) => boolean;
	children: ReactNode;
}) {
	const [panel, setPanel] = useState(false);
	const [button, setButton] = useState<HTMLButtonElement | null>(null);
	return (
		<Popover
			open={panel}
			onOpenChange={(next, details) => {
				if (!next && details.reason === "escape-key" && escapeKeepsOpen?.(details.event?.target ?? null)) return details.cancel();
				setPanel(next);
			}}
		>
			<span className="inline-flex">
				<DisplayButton label={label} control={control} active={active || panel} tooltipHidden={panel} buttonRef={setButton}>
					{menu(() => setPanel(true))}
				</DisplayButton>
			</span>
			<PopoverContent
				anchor={button ?? undefined}
				align="end"
				collisionPadding={8}
				// With no trigger of its own, the popover hands focus back to **Display** as it closes.
				finalFocus={button ?? "trigger"}
				className={cn("max-h-(--available-height) max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto p-3", panelClassName)}
			>
				<PopoverHeader>
					<PopoverTitle className="text-sm">
						{title}
					</PopoverTitle>
					<PopoverDescription className="text-xs">{description}</PopoverDescription>
				</PopoverHeader>
				{children}
			</PopoverContent>
		</Popover>
	);
}

/** **Display**'s **Grouping** submenu: a radio per grouping of `groupings`, named by `labels`, `value` picked. */
export function GroupingSubmenu<G extends string>({ groupings, labels, value, control, onValue }: { groupings: readonly G[]; labels: Record<G, string>; value: G; control: ControlId; onValue: (grouping: G) => void }) {
	return (
		<MenuSubmenu>
			<MenuSubmenuTrigger value={labels[value]}>Grouping</MenuSubmenuTrigger>
			<MenuSubmenuContent className="w-48">
				<MenuRadioGroup value={value} onValueChange={(next: G) => onValue(next)}>
					{groupings.map(grouping => (
						<MenuRadioItem {...activityControl(control)} key={grouping} value={grouping} closeOnSelect>
							{labels[grouping]}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuSubmenuContent>
		</MenuSubmenu>
	);
}

/**
 * The bar above a list: `tabs`, then **Filter**, marked while `filtering`, and `display`, the
 * **Display** button, at the end of their row; under them a chip per field that leaves something out, with **Clear
 * all**, which calls `onClearAll`. `controls` are the activity controls of **Filter** and of the chips' clearing.
 */
export function ListFilterBar({
	tabs,
	fields,
	filtering,
	controls,
	onClearAll,
	display,
	className,
}: {
	tabs: ReactNode;
	fields: readonly FilterField[];
	filtering: boolean;
	controls: { filter: ControlId; clear: ControlId };
	onClearAll: () => void;
	display?: ReactNode;
	className?: string;
}) {
	const filterRef = useRef<HTMLButtonElement>(null);
	return (
		<div className={cn("space-y-2", className)}>
			<div className="flex items-center gap-2">
				{tabs}
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<FilterMenu fields={fields} active={filtering} control={controls.filter} triggerRef={filterRef} />
					{display}
				</div>
			</div>
			<FilterChips fields={fields} clearControl={controls.clear} onClearAll={onClearAll} filterRef={filterRef} />
		</div>
	);
}

/** What {@link NothingMatches} offers while neither the search nor **Filter** leave anything out, such as a tab that keeps nothing. */
export interface NothingMatchesFallback {
	text: string;
	/** The button's name. */
	label: string;
	control: ControlId;
	onClick: () => void;
}

/**
 * What a list shows while the search, **Filter**, or what `fallback` names keep nothing of it: a note, which starts with
 * `noneMatch`, such as `No issues match`, and a button that clears the search and the filters, the fallback last; nothing
 * while none of them leaves anything out. The button hands focus to `focusTarget`, since it leaves as the list fills.
 */
export function NothingMatches({
	noneMatch,
	search,
	filtering,
	control,
	onClearSearch,
	onClearFilters,
	fallback,
	focusTarget,
}: {
	noneMatch: string;
	/** The search, trimmed. */
	search: string;
	filtering: boolean;
	/** The activity control of the button while it clears the search or the filters. */
	control: ControlId;
	onClearSearch: () => void;
	onClearFilters: () => void;
	fallback?: NothingMatchesFallback;
	focusTarget: RefObject<HTMLElement | null>;
}) {
	const both = search !== "" && filtering;
	const shown: NothingMatchesFallback | undefined =
		search !== "" || filtering
			? {
					text: `${noneMatch} ${both ? "the search and these filters" : search ? `“${search}”` : "these filters"}.`,
					label: `Clear the ${both ? "search and filters" : search ? "search" : "filters"}`,
					control,
					onClick: () => {
						if (search) onClearSearch();
						if (filtering) onClearFilters();
					},
				}
			: fallback;
	if (!shown) return null;
	return (
		<div className="space-y-3 px-3 py-2">
			<p className="text-sm text-muted-foreground">{shown.text}</p>
			<Button
				{...activityControl(shown.control)}
				size="compact"
				variant="outline"
				onClick={() => {
					focusTarget.current?.focus();
					shown.onClick();
				}}
			>
				{shown.label}
			</Button>
		</div>
	);
}
