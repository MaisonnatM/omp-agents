/** Linear's field pickers: a button that opens a searchable list of a field's choices, and the due date's. The issue detail, the new-issue dialog, the Todo page, and a pull request's details share them. */
import { Calendar, Check, Ellipsis } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { dateLabel } from "../labels";

/** A field's button in a side column: the row's width, its value in the text's color, and room for wrapped labels. */
export const FIELD_BUTTON = "h-auto min-h-8 w-full justify-start px-2 py-1 text-[13px] font-normal text-foreground";
/** A field's pill in the new-issue dialog, as Linear's own dialog draws them. */
const CHIP_BUTTON = "max-w-56 rounded-full px-2.5 font-normal text-foreground";

/** Where a picker sits: a row of a side column, or a pill in the new-issue dialog. */
export type PickerLook = "field" | "chip";

const pickerButton = (look: PickerLook, className: string | undefined): { variant: "ghost" | "tertiary"; className: string } =>
	look === "chip" ? { variant: "tertiary", className: className ?? CHIP_BUTTON } : { variant: "ghost", className: className ?? FIELD_BUTTON };

export interface Choice {
	value: string;
	label: string;
	icon?: ReactNode;
}

/** Whether a picker is open: its own state, or its owner's when `open` is given, so a key can open it. */
interface OpenState {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

function useOpenState({ open, onOpenChange }: OpenState): [boolean, (open: boolean) => void] {
	const [own, setOwn] = useState(false);
	return [
		open ?? own,
		next => {
			setOwn(next);
			onOpenChange?.(next);
		},
	];
}

interface FieldPickerProps extends OpenState {
	/** What the field is, for the search box and screen readers: `Status`. */
	field: string;
	/** What the field holds now, in words, for screen readers. */
	current: string;
	trigger: ReactNode;
	look?: PickerLook;
	/** The trigger button's classes, in place of the look's. */
	className?: string;
	/** `null` while the choices load, or when they failed to, with `error`. */
	choices: Choice[] | null;
	error?: string | null;
	selected: string[];
	/** Several choices at once: the list stays open while the choices toggle. */
	multi?: boolean;
	/** The field cannot change yet, as before the item's details arrive. */
	disabled?: boolean;
	/** The digit that picks the first choice while the list is open, the next digit the next one, as Linear's status (1) and priority (0) menus do. */
	firstKey?: number;
	/** A click opened the list: the fields ask for the choices then. */
	onOpen?: () => void;
	onPick: (value: string) => void;
}

/** A field as a button that opens a searchable list of its choices, as Linear's issue fields do. */
export function FieldPicker({ field, current, trigger, look = "field", className, choices, error = null, selected, multi = false, disabled = false, firstKey, onOpen, onPick, ...openState }: FieldPickerProps) {
	const [open, setOpen] = useOpenState(openState);
	const pick = (value: string): void => {
		if (!multi) setOpen(false);
		onPick(value);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (firstKey === undefined || choices === null || !/^\d$/.test(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
		const choice = choices[Number(event.key) - firstKey];
		if (!choice) return;
		event.preventDefault();
		pick(choice.value);
	};
	return (
		<Popover
			open={open}
			onOpenChange={next => {
				setOpen(next);
				if (next) onOpen?.();
			}}
		>
			<Tooltip content={`Change ${field.toLowerCase()}: ${current}`} side="bottom" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button size="compact" {...pickerButton(look, className)} aria-label={`${field}: ${current}`} data-state={open ? "open" : "closed"} active={open} disabled={disabled}>
						<span className="flex min-w-0 items-center gap-2">{trigger}</span>
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent align="start" className="w-64 p-0" onKeyDown={onKeyDown}>
				<Command>
					<CommandInput aria-label={`Search ${field.toLowerCase()}`} placeholder={`${field}…`} />
					<CommandList>
						{choices === null ? (
							<p role={error ? "alert" : undefined} className={cn("px-3 py-2 text-xs", error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
								{error ?? "Loading the choices…"}
							</p>
						) : (
							<>
								<CommandEmpty>No match.</CommandEmpty>
								<CommandGroup>
									{choices.map((choice, index) => (
										<CommandItem key={choice.value} value={choice.value} keywords={[choice.label]} onSelect={() => pick(choice.value)}>
											{choice.icon}
											<span className="truncate">{choice.label}</span>
											<Check aria-hidden className={cn("ml-auto", selected.includes(choice.value) ? "opacity-100" : "opacity-0")} />
											{firstKey !== undefined && <kbd className="text-xs text-muted-foreground tabular-nums">{firstKey + index}</kbd>}
										</CommandItem>
									))}
								</CommandGroup>
							</>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

interface DuePickerProps extends OpenState {
	/** `YYYY-MM-DD`, `null` for none. */
	dueDate: string | null;
	disabled: boolean;
	/** What the button shows; a calendar and the date by default. */
	trigger?: ReactNode;
	look?: PickerLook;
	/** The trigger button's classes, in place of the look's. */
	className?: string;
	onChange: (dueDate: string | null) => void;
}

/** The due date: a date field to set it, and a button to clear it. As a pill without a date, it waits behind a more button, as in Linear. */
export function DuePicker({ dueDate, disabled, trigger, look = "field", className, onChange, ...openState }: DuePickerProps) {
	const [open, setOpen] = useOpenState(openState);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content={dueDate ? `Change the due date: ${dateLabel(dueDate)}` : "Set a due date"} side="bottom" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					{look === "chip" && !dueDate && trigger === undefined ? (
						<Button variant="tertiary" size="icon-compact" className="rounded-full" aria-label="More fields: set a due date" data-state={open ? "open" : "closed"} active={open} disabled={disabled}>
							<Ellipsis />
						</Button>
					) : (
						<Button size="compact" {...pickerButton(look, className)} aria-label={`Due date: ${dueDate ?? "none"}`} data-state={open ? "open" : "closed"} active={open} disabled={disabled}>
							<span className="flex min-w-0 items-center gap-2">
								{trigger ?? (
									<>
										<Calendar aria-hidden className="size-4 text-muted-foreground" />
										{dueDate ? dateLabel(dueDate) : <span className="text-muted-foreground">Set due date</span>}
									</>
								)}
							</span>
						</Button>
					)}
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent align="start" className="w-auto p-2">
				<form
					onSubmit={event => {
						event.preventDefault();
						// React bubbles events through the popover's portal, so a form around the picker would submit too.
						event.stopPropagation();
						const value = new FormData(event.currentTarget).get("due");
						setOpen(false);
						if (typeof value === "string" && value !== "" && value !== dueDate) onChange(value);
					}}
					className="flex items-center gap-1.5"
				>
					<input type="date" name="due" aria-label="Due date" defaultValue={dueDate ?? ""} required className="h-7 rounded-md border border-border bg-background px-2 text-xs" />
					<Button type="submit" variant="secondary" size="compact">
						Set
					</Button>
					{dueDate && (
						<Button
							type="button"
							variant="ghost"
							size="compact"
							onClick={() => {
								setOpen(false);
								onChange(null);
							}}
						>
							Clear
						</Button>
					)}
				</form>
			</PopoverContent>
		</Popover>
	);
}
