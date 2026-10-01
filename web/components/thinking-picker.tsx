import { Brain, Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ThinkingPickerProps {
	/** omp's thinking level, or `null` before the session reports one. */
	current: string | null;
	/** Levels the session's model accepts, `off` first. */
	levels: string[];
	onPick: (level: string) => void;
}

/** The composer's thinking-level switch: omp's levels for the current model, lowest first. */
export function ThinkingPicker({ current, levels, onPick }: ThinkingPickerProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="compact"
					leadingIcon={Brain}
					trailingIcon={ChevronsUpDown}
					aria-label={`Choose thinking level: ${current ?? "none selected"}`}
					active={open}
				>
					{current ?? "Thinking"}
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-40 p-0" onMouseDown={event => event.stopPropagation()}>
				<Command>
					<CommandList>
						<CommandGroup heading="Thinking level">
							{levels.map(level => (
								<CommandItem
									key={level}
									value={level}
									onSelect={() => {
										setOpen(false);
										if (level !== current) onPick(level);
									}}
								>
									{level}
									<Check className={cn("ml-auto", level === current ? "opacity-100" : "opacity-0")} />
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
