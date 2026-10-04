import { Check, ChevronsUpDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** What the list shows: a status line while it loads, the error when it failed, else its groups. */
export type PickerState = { kind: "loading"; message: string } | { kind: "failed"; error: string } | { kind: "ready" };

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
	heading?: ReactNode;
	/** Not drawn while empty, so a heading never sits over nothing. */
	items: PickerItem[];
	/** Shows the group and its items whatever the search, as cmdk's `forceMount` does. */
	forceMount?: boolean;
}

const WIDTH = {
	sm: "w-40",
	md: "w-[min(20rem,calc(100vw-2rem))]",
	lg: "w-[min(24rem,calc(100vw-2rem))]",
} as const;

interface CommandPickerProps {
	/** The trigger button's content. */
	trigger: ReactNode;
	/** The trigger button's own props; `trailingIcon` is the up-down chevron unless given, even as `undefined`. */
	button?: Omit<ComponentProps<typeof Button>, "children" | "variant" | "size" | "active" | "asChild">;
	/** The search field, as its label (`Search models`), with `value`/`onChange` to own what is typed; no field when omitted. */
	search?: { label: string; value?: string; onChange?: (value: string) => void };
	width: keyof typeof WIDTH;
	/** Which side of the trigger the list opens on; the composer's pickers open upward. */
	side?: "top" | "bottom";
	/** Controlled when given; `onOpenChange` is told of every change either way. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	state?: PickerState;
	groups: PickerGroup[];
	/** What the list reads when no item matches; nothing when omitted. */
	empty?: ReactNode;
}

/** A button that opens a searchable, grouped list of choices; picking one closes it. The dashboard's every combobox. */
export function CommandPicker({ trigger, button, search, width, side, open, onOpenChange, state = { kind: "ready" }, groups, empty }: CommandPickerProps) {
	const [inner, setInner] = useState(false);
	const shown = open ?? inner;
	const change = (next: boolean): void => {
		if (open === undefined) setInner(next);
		onOpenChange?.(next);
	};
	return (
		<Popover open={shown} onOpenChange={change}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" trailingIcon={ChevronsUpDown} active={shown} {...button}>
					{trigger}
				</Button>
			</PopoverTrigger>
			<PopoverContent side={side} align="start" className={cn(WIDTH[width], "p-0")} onMouseDown={event => event.stopPropagation()}>
				<Command>
					{search && <CommandInput aria-label={search.label} placeholder={`${search.label}…`} value={search.value} onValueChange={search.onChange} />}
					<CommandList>
						{state.kind === "loading" ? (
							<p role="status" className="py-6 text-center text-sm text-muted-foreground">
								{state.message}
							</p>
						) : state.kind === "failed" ? (
							<p role="alert" className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
								{state.error}
							</p>
						) : (
							<>
								{empty && <CommandEmpty className="px-3 py-6 text-center text-sm">{empty}</CommandEmpty>}
								{groups
									.filter(group => group.items.length > 0)
									.map((group, index) => (
										<CommandGroup key={index} heading={group.heading} forceMount={group.forceMount}>
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
