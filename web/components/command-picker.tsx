import { Check, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { type ShortcutId, shortcutLabels, shortcutOf } from "../shortcuts";

export interface PickerItem {
	/** What cmdk filters and keys on; unique across the picker. */
	value: string;
	label: ReactNode;
	keywords?: string[];
	title?: string;
	/** Draws the check mark, shown when `true`; omit it for an action, like creating a branch, that has nothing to check. */
	selected?: boolean;
	/** Runs after the picker closes. */
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

/** A list the server sends as `{ …, error }`, or `null` before it arrives, as a {@link PickerList}. */
export function fromList<T extends { error: string | null }>(list: T | null, loading: string, groups: (list: T) => PickerGroup[]): PickerList {
	if (list === null) return { kind: "loading", message: loading };
	if (list.error) return { kind: "failed", error: list.error };
	return { kind: "ready", groups: groups(list) };
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
	title?: string;
	/** The shortcut that runs the trigger's action: its keys show in a tooltip after `title`, or after the shortcut's own label without one. */
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
}

/** A button that opens a searchable, grouped list of choices; picking one closes it. The dashboard's every combobox. */
export function CommandPicker({ trigger, icon, chevron = true, ariaLabel, title, shortcut, disabled, className, search, width, side, open, onOpenChange, list, empty }: CommandPickerProps) {
	const [inner, setInner] = useState(false);
	const shown = open ?? inner;
	const change = (next: boolean): void => {
		if (open === undefined) setInner(next);
		onOpenChange?.(next);
	};
	const button = (
		<Button
			variant="ghost"
			size="compact"
			leadingIcon={icon}
			trailingIcon={chevron ? ChevronsUpDown : undefined}
			aria-label={ariaLabel}
			title={shortcut ? undefined : title}
			// A shortcut tooltip's trigger would stamp its own open state over the popover's.
			data-state={shown ? "open" : "closed"}
			disabled={disabled}
			active={shown}
			className={className}
		>
			{trigger}
		</Button>
	);
	return (
		<Popover open={shown} onOpenChange={change}>
			{shortcut ? (
				<Tooltip content={title ?? shortcutOf(shortcut).label} shortcut={shortcutLabels(shortcut)} side={side ?? "bottom"} forceOpen={shown ? false : undefined}>
					<PopoverTrigger asChild>{button}</PopoverTrigger>
				</Tooltip>
			) : (
				<PopoverTrigger asChild>{button}</PopoverTrigger>
			)}
			{/* A click in the list must not reach the composer around a picker, which would take the focus back to its text box. */}
			<PopoverContent side={side} align="start" className={cn(WIDTH[width], "p-0")} onMouseDown={event => event.stopPropagation()}>
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
													forceMount={group.forceMount}
													onSelect={() => {
														change(false);
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
				</Command>
			</PopoverContent>
		</Popover>
	);
}
