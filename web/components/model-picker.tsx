import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import type { ModelOption } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ModelPickerProps {
	/** The session's `provider/id`, or `null` before it reports one. */
	current: string | null;
	/** The last list the server sent for this session, or `null` while none has arrived. */
	list: { models: ModelOption[]; error: string | null } | null;
	/** Refresh the list from omp whenever the picker opens. */
	onOpen: () => void;
	onPick: (model: ModelOption) => void;
}

function byProvider(models: ModelOption[]): [string, ModelOption[]][] {
	const groups = new Map<string, ModelOption[]>();
	for (const model of models) {
		const group = groups.get(model.provider);
		if (group) group.push(model);
		else groups.set(model.provider, [model]);
	}
	return [...groups];
}

/** The composer's model switch: a searchable list of the session's models, grouped by provider. */
export function ModelPicker({ current, list, onOpen, onPick }: ModelPickerProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover
			open={open}
			onOpenChange={next => {
				setOpen(next);
				if (next) onOpen();
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" trailingIcon={ChevronsUpDown} title={current ?? undefined} aria-label={`Choose model: ${current ? current.slice(current.indexOf("/") + 1) : "none selected"}`} active={open}>
					<span className="max-w-56 truncate">{current ? current.slice(current.indexOf("/") + 1) : "Choose model"}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0" onMouseDown={event => event.stopPropagation()}>
				<Command>
					<CommandInput aria-label="Search models" placeholder="Search models…" />
					<CommandList>
						{list === null ? (
							<p role="status" className="py-6 text-center text-sm text-muted-foreground">
								Loading models…
							</p>
						) : list.error ? (
							<p role="alert" className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
								{list.error}
							</p>
						) : (
							<>
								<CommandEmpty>No model matches.</CommandEmpty>
								{byProvider(list.models).map(([provider, models]) => (
									<CommandGroup key={provider} heading={provider}>
										{models.map(model => {
											const selector = `${model.provider}/${model.id}`;
											return (
												<CommandItem
													key={selector}
													value={selector}
													onSelect={() => {
														setOpen(false);
														if (selector !== current) onPick(model);
													}}
												>
													<span className="truncate">{model.id}</span>
													<Check className={cn("ml-auto", selector === current ? "opacity-100" : "opacity-0")} />
												</CommandItem>
											);
										})}
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
