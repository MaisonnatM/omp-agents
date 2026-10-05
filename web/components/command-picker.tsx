import { Check, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { ReadState } from "../reads";
import { type ShortcutId, shortcutLabels } from "../shortcuts";

export interface PickerItem {
	/** What cmdk filters and keys on; unique across the picker. */
	value: string;
	label: ReactNode;
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
	/** Shows the group and its items whatever the search, as cmdk's `forceMount` does. */
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
	closeOnSelect?: boolean;
	selectionDisabled?: boolean;
	/** Wraps the command list with additional controls inside the same popover. */
	content?: (command: ReactNode) => ReactNode;
}

/** A button that opens a searchable, grouped list of choices; picking one closes it. The dashboard's every combobox. */
export function CommandPicker({ trigger, icon, chevron = true, ariaLabel, tooltip, shortcut, disabled, className, search, width, side, open, onOpenChange, list, empty, closeOnSelect = true, selectionDisabled = false, content = command => command }: CommandPickerProps) {
	const [inner, setInner] = useState(false);
	const shown = open ?? inner;
	const change = (next: boolean): void => {
		if (open === undefined) setInner(next);
		onOpenChange?.(next);
	};
	const button = (
		<PopoverTrigger asChild>
			<Button
				variant="ghost"
				size="compact"
				leadingIcon={icon}
				trailingIcon={chevron ? ChevronsUpDown : undefined}
				aria-label={ariaLabel}
				// Keeps Radix's popover `data-state` contract under a Tooltip trigger, which stamps its own.
				data-state={shown ? "open" : "closed"}
				disabled={disabled}
				active={shown}
				className={className}
			>
				{trigger}
			</Button>
		</PopoverTrigger>
	);
	return (
		<Popover open={shown} onOpenChange={change}>
			{tooltip ? (
				<Tooltip content={tooltip} shortcut={shortcut && shortcutLabels(shortcut)} side={side ?? "bottom"} forceOpen={shown ? false : undefined}>
					{button}
				</Tooltip>
			) : (
				button
			)}
			{/* A click in the list must not reach the composer around a picker, which would take the focus back to its text box. */}
			<PopoverContent side={side} align="start" className={cn(WIDTH[width], "min-w-0 max-h-[var(--radix-popover-content-available-height)] overflow-x-hidden overflow-y-auto overscroll-contain p-0")} onMouseDown={event => event.stopPropagation()}>
				{content(
				<Command>
					{search && <CommandInput aria-label={search.label} placeholder={`${search.label}…`} value={search.query?.value} onValueChange={search.query?.onChange} />}
					<CommandList>
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
								{empty && <CommandEmpty className="px-3 py-6 text-center text-sm">{empty}</CommandEmpty>}
								{list.groups
									.filter(group => group.items.length > 0)
									.map(group => (
										<CommandGroup key={group.key} heading={group.heading} forceMount={group.forceMount}>
											{group.items.map(item => (
												<CommandItem
													key={item.value}
													value={item.value}
													keywords={item.keywords}
													title={item.title}
													aria-label={item.ariaLabel}
													forceMount={group.forceMount}
													disabled={disabled || selectionDisabled}
													onSelect={() => {
														if (closeOnSelect) change(false);
														item.onSelect();
													}}
												>
													<span className="flex min-w-0 flex-1 items-center gap-2">{item.label}</span>
													{item.selected !== undefined && <Check className={item.selected ? "opacity-100" : "opacity-0"} />}
												</CommandItem>
											))}
										</CommandGroup>
									))}
							</>
						)}
					</CommandList>
				</Command>)}
			</PopoverContent>
		</Popover>
	);
}
