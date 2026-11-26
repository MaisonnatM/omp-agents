/** The field picker: a button that opens a searchable list of a field's choices, as a pull request's details use. */
import { IconCheckmark1 } from "central-icons";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A field's button in a side column: the row's width, its value in the text's color, and room for wrapped labels. */
const FIELD_BUTTON = "h-auto min-h-8 w-full justify-start px-2 py-1 text-[13px] font-normal text-foreground";
/** A field's button laid in a property row of a pull request's details: its text lines up with the row's, and it spans the row. */
export const ROW_BUTTON = "-mx-2 -my-1 h-auto min-h-6 w-[calc(100%+1rem)] justify-start px-2 py-1 text-xs font-normal text-foreground";

/** Where a picker sits: a row of a side column, or a property row of the details. */
export type PickerLook = "field" | "row";

const LOOK_BUTTON: Record<PickerLook, string> = { field: FIELD_BUTTON, row: ROW_BUTTON };

const pickerButton = (look: PickerLook, className: string | undefined): { variant: "ghost"; className: string } => ({ variant: "ghost", className: className ?? LOOK_BUTTON[look] });

export interface Choice {
	value: string;
	label: string;
	/** Muted text after the label, such as a person's login after their name. */
	detail?: string;
	icon?: ReactNode;
}

interface FieldPickerProps {
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
	/** A click opened the list: the fields ask for the choices then. */
	onOpen?: () => void;
	onPick: (value: string) => void;
}

/** A field as a button that opens a searchable list of its choices. */
export function FieldPicker({ field, current, trigger, look = "field", className, choices, error = null, selected, multi = false, disabled = false, onOpen, onPick }: FieldPickerProps) {
	const [open, setOpen] = useState(false);
	const pick = (value: string): void => {
		if (!multi) setOpen(false);
		onPick(value);
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
				<PopoverTrigger
					render={
						<Button size="compact" {...pickerButton(look, className)} aria-label={`${field}: ${current}`} active={open} disabled={disabled}>
							<span className="flex min-w-0 items-center gap-2">{trigger}</span>
						</Button>
					}
				/>
			</Tooltip>
			<PopoverContent align="start" className="w-64 p-0">
				<Command>
					<CommandInput aria-label={`Search ${field.toLowerCase()}`} placeholder={`${field}…`} />
					{choices !== null && <CommandEmpty>No match.</CommandEmpty>}
					<CommandList>
						{choices === null ? (
							<p role={error ? "alert" : undefined} className={cn("px-3 py-2 text-xs", error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
								{error ?? "Loading the choices…"}
							</p>
						) : (
							<CommandGroup>
								{choices.map(choice => (
									// A choice without a value of its own, as for none, keys on its label.
									<CommandItem key={choice.value} value={choice.value || choice.label} label={choice.label} keywords={[choice.value]} onSelect={() => pick(choice.value)}>
										{choice.icon}
										<span className="truncate">{choice.label}</span>
										{choice.detail && <span className="flex-1 truncate text-muted-foreground">{choice.detail}</span>}
										<IconCheckmark1 className={cn("ml-auto", selected.includes(choice.value) ? "opacity-100" : "opacity-0")} />
									</CommandItem>
								))}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
