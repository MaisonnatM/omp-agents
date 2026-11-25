/** `CommandPicker`, the searchable grouped list behind the branch, workspace, skill, and settings pickers, and `CommandResults`, which the model menu's search shares. */
import { IconCheckmark1, IconChevronGrabberVertical } from "central-icons";
import { fuzzyScore } from "@ui-sdk/react/text-match";
import { type KeyboardEvent, type ReactNode, type Ref, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { ControlId } from "../../src/shared/activity";
import type { ModuleControlId } from "../modules";
import { activityControl } from "../activity";
import type { ReadState } from "../reads";
import { type ShortcutId, shortcutLabels } from "../shortcuts";
import { ComposerEditor } from "./composer";

export interface PickerItem {
	/** What the search matches, with `keywords`, and keys on; unique across the picker. */
	value: string;
	label: ReactNode;
	/** Drawn before the label, as for an action such as moving the workspace. */
	icon?: IconComponent;
	keywords?: string[];
	title?: string;
	ariaLabel?: string;
	/** Draws the check mark, shown when `true`; omit it for an action, like creating a branch, that has nothing to check. */
	selected?: boolean;
	/** Runs after selection, and after closing unless `closeOnSelect` is false. */
	onSelect: () => void;
}

export interface PickerGroup {
	key: string;
	heading?: ReactNode;
	/** Not drawn while empty, so a heading never sits over nothing. */
	items: PickerItem[];
	/** Shows the group and its items whatever the search. */
	forceMount?: boolean;
}

/** What the list shows: a status line while it loads, the error when it failed, else its groups. */
export type PickerList = { kind: "loading"; message: string } | { kind: "failed"; error: string } | { kind: "ready"; groups: PickerGroup[] };

/** A server read as a {@link PickerList}: `loading` until it answers, its error if it failed, else the groups of its data. */
export function fromList<T>(read: ReadState<T>, loading: string, groups: (data: T) => PickerGroup[]): PickerList {
	if (read.error) return { kind: "failed", error: read.error };
	if (read.data === null) return { kind: "loading", message: loading };
	return { kind: "ready", groups: groups(read.data) };
}

/** Whether, or how well, a choice matches what is typed: 0 or `false` hides it. */
type PickerFilter = (item: { value: string; label: string; keywords?: string[] }, query: string) => boolean | number;

const fuzzy: PickerFilter = (item, query) => fuzzyScore([item.label, ...(item.keywords ?? [])].join(" "), query);

interface CommandResultsProps {
	search?: { label: string; query?: { value: string; onChange: (value: string) => void }; ref?: Ref<HTMLInputElement> };
	list: PickerList;
	empty?: ReactNode;
	disabled?: boolean;
	selectionDisabled?: boolean;
	closeOnSelect?: boolean;
	/** Closes the surface that holds the list, when a choice asks to close. */
	onClose?: () => void;
	filter?: PickerFilter;
	onKeyDown?: (event: KeyboardEvent) => void;
	listClassName?: string;
}

/** The search field and grouped results a {@link CommandPicker} and the model menu's search share. */
export function CommandResults({ search, list, empty, disabled, selectionDisabled = false, closeOnSelect = true, onClose, filter, onKeyDown, listClassName }: CommandResultsProps) {
	const groups = list.kind === "ready" ? list.groups.filter(group => group.items.length > 0) : [];
	const shown = new Set(groups.flatMap(group => (group.forceMount ? group.items.map(item => item.value) : [])));
	const match = filter ?? fuzzy;
	return (
		<Command
			filter={shown.size > 0 ? (item, query) => shown.has(item.value) || match(item, query) : filter}
			query={search?.query?.value}
			onQueryChange={search?.query?.onChange}
			onKeyDown={onKeyDown}
		>
			{search && <CommandInput ref={search.ref} aria-label={search.label} placeholder={`${search.label}…`} />}
			{empty && list.kind === "ready" && <CommandEmpty className="px-3 py-6 text-center text-sm">{empty}</CommandEmpty>}
			<CommandList className={listClassName}>
				{list.kind === "loading" ? (
					<p role="status" className="py-6 text-center text-sm text-muted-foreground">
						{list.message}
					</p>
				) : list.kind === "failed" ? (
					<p role="alert" className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
						{list.error}
					</p>
				) : (
					<>
						{groups.map(group => (
								<CommandGroup key={group.key} heading={group.heading}>
									{group.items.map(item => (
										<CommandItem
											key={item.value}
											value={item.value}
											label={item.value}
											keywords={item.keywords}
											title={item.title}
											aria-label={item.ariaLabel}
											disabled={disabled || selectionDisabled}
											onSelect={() => {
												if (closeOnSelect) onClose?.();
												item.onSelect();
											}}
										>
											<span className="flex min-w-0 flex-1 items-center gap-2">
												{item.icon && <item.icon />}
												{item.label}
											</span>
											{item.selected !== undefined && <IconCheckmark1 className={item.selected ? "opacity-100" : "opacity-0"} />}
										</CommandItem>
									))}
								</CommandGroup>
							))}
					</>
				)}
			</CommandList>
		</Command>
	);
}

const WIDTH = {
	sm: "w-40",
	md: "w-[min(20rem,calc(100vw-2rem))]",
	lg: "w-[min(24rem,calc(100vw-2rem))]",
} as const;

interface CommandPickerProps {
	/** The trigger button's content. */
	trigger: ReactNode;
	icon?: IconComponent;
	/** The up-down chevron after the trigger's content; `false` for a button that adds rather than switches. */
	chevron?: boolean;
	ariaLabel?: string;
	ariaLabelledby?: string;
	/** What hovering the trigger says; no tooltip when omitted. */
	tooltip?: string;
	/** Adds this shortcut's keys to the tooltip. */
	shortcut?: ShortcutId;
	disabled?: boolean;
	className?: string;
	/** The search field, by its label (`Search models`); `query` when the caller reads what is typed. No field when omitted. */
	search?: { label: string; query?: { value: string; onChange: (value: string) => void } };
	width: keyof typeof WIDTH;
	/** Which side of the trigger the list opens on; the composer's pickers open upward. */
	side?: "top" | "bottom";
	/** Controlled when given; `onOpenChange` is told of every change either way. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	list: PickerList;
	/** What the list reads when no item matches; nothing when omitted. */
	empty?: ReactNode;
	/** The Activity control a click on the trigger records; none when omitted. */
	control?: ControlId | ModuleControlId;
}

/** A button that opens a searchable, grouped list of choices; picking one closes it. The dashboard's every combobox. */
export function CommandPicker({ trigger, icon, chevron = true, ariaLabel, ariaLabelledby, tooltip, shortcut, disabled, className, search, width, side, open, onOpenChange, list, empty, control }: CommandPickerProps) {
	const [inner, setInner] = useState(false);
	const shown = open ?? inner;
	const change = (next: boolean): void => {
		if (open === undefined) setInner(next);
		onOpenChange?.(next);
	};
	const composer = useContext(ComposerEditor);
	const picked = useRef(false);
	const button = (
		<PopoverTrigger
			render={
				<Button
					{...(control ? activityControl(control) : {})}
					variant="ghost"
					size="compact"
					leadingIcon={icon}
					trailingIcon={chevron ? IconChevronGrabberVertical : undefined}
					aria-label={ariaLabel}
					aria-labelledby={ariaLabelledby}
					disabled={disabled}
					active={shown}
					className={className}
				>
					{trigger}
				</Button>
			}
		/>
	);
	return (
		<Popover open={shown} onOpenChange={change}>
			{tooltip ? (
				<Tooltip content={tooltip} shortcut={shortcut && shortcutLabels(shortcut)} side={side ?? "bottom"} forceOpen={shown ? false : undefined} disabled={disabled} wrapperClassName="min-w-0">
					{button}
				</Tooltip>
			) : (
				button
			)}
			{/* A click in the list must not reach the composer around a picker, which would take the focus back to its text box. */}
			<PopoverContent
				side={side}
				align="start"
				className={cn(WIDTH[width], "min-w-0 max-h-(--available-height) overflow-x-hidden overflow-y-auto overscroll-contain p-0")}
				onMouseDown={event => event.stopPropagation()}
				finalFocus={() => {
					const refocus = picked.current && composer !== null;
					picked.current = false;
					if (!refocus) return undefined;
					composer.current?.focus();
					return document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
				}}
			>
				<CommandResults
					search={search}
					list={list}
					empty={empty}
					disabled={disabled}
					onClose={() => {
						picked.current = true;
						change(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
