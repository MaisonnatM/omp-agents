/**
 * The pieces of a list page's bar that do not depend on what it lists: its view tabs, **Filter** with a submenu per
 * field, the chip per filter that leaves something out with **Clear all**, and the **Display** button's shell.
 */
import { IconCrossMedium, IconFilter1, IconSettingsSliderHor } from "central-icons";
import { type ComponentType, type ReactNode, type Ref, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuCheckItem, MenuRadioGroup, MenuRadioItem, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { DAY_RANGE_LABELS, DAY_RANGES, type DayRange, type FilterOption } from "../list-filter";

/** One field **Filter** filters by: its submenu's rows, and what its chip says while it leaves something out. */
export interface FilterField {
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
export interface FieldBase {
	id: string;
	label: string;
	icon: FilterField["icon"];
	control: ControlId;
}

/** A check per option, whose `checked` keeps them, with its count where it has one; checking one leaves the menu open, so you can check several. */
export function checkItems<K extends string>(options: readonly FilterOption<K>[], checked: ReadonlySet<K>, control: ControlId, onToggle: (key: K) => void, disabled?: (key: K) => boolean): ReactNode {
	return options.map(({ key, label, count }) => (
		<MenuCheckItem {...activityControl(control)} key={key} checked={checked.has(key)} disabled={disabled?.(key)} closeOnClick={false} onCheckedChange={() => onToggle(key)}>
			<span className="truncate">{label}</span>
			{count !== undefined && <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{count}</span>}
		</MenuCheckItem>
	));
}

/** A field that keeps the items whose value is any of `checked`, of its `options`; its chip names one, or counts several of `noun`. */
export function setField<K extends string>({
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

/** A field that keeps the items of the last {@link DayRange} by one of their dates, with **Any time** first, one picked. */
export function dayField({ id, label, icon, control, value, onValue }: FieldBase & { value: DayRange | null; onValue: (value: DayRange | null) => void }): FilterField {
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

/** `Field · verb · value · ×`: what a filter keeps, whose value reopens its rows and whose ×, with `clearControl`, removes it. */
export function FilterChip({ field, clearControl }: { field: FilterField; clearControl: ControlId }) {
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
				<button {...activityControl(clearControl)} type="button" aria-label={`Remove the ${label.toLowerCase()} filter`} className={`${cell} text-muted-foreground hover:text-foreground ${pressable}`} onClick={clear}>
					<IconCrossMedium aria-hidden className="size-3" />
				</button>
			</Tooltip>
		</div>
	);
}

/** **Filter**: the icon button, marked while `active`, whose menu has a submenu per field, each naming what it keeps while it leaves something out. */
export function FilterMenu({ fields, active, control }: { fields: readonly FilterField[]; active: boolean; control: ControlId }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content="Filter" forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button {...activityControl(control)} variant="outline" size="icon-compact" aria-label="Filter" active={active} />}>
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

/**
 * The row of chips under the bar, one per field that leaves something out, and **Clear all** once there are two;
 * nothing while no field does. `clearControl` is the activity control of each × and of **Clear all**.
 */
export function FilterChips({ fields, clearControl, onClearAll }: { fields: readonly FilterField[]; clearControl: ControlId; onClearAll: () => void }) {
	const chips = fields.filter(({ active }) => active);
	if (chips.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{chips.map(field => (
				<FilterChip key={field.id} field={field} clearControl={clearControl} />
			))}
			{chips.length > 1 && (
				<Button {...activityControl(clearControl)} variant="ghost" size="compact" className="text-muted-foreground" onClick={onClearAll}>
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
 * while the menu is open or while `tooltipHidden`, such as while a popover it opened is up; `buttonRef` reaches the
 * button, to hand focus back to it.
 */
export function DisplayButton({
	label,
	control,
	active,
	open,
	onOpenChange,
	tooltipHidden = false,
	buttonRef,
	menuClassName = "w-72",
	children,
}: {
	label: string;
	control: ControlId;
	active: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tooltipHidden?: boolean;
	buttonRef?: Ref<HTMLButtonElement>;
	menuClassName?: string;
	children: ReactNode;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
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
