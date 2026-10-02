import { Check, ChevronsUpDown } from "lucide-react";
import type { ModelOption } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { modelLabel, modelOrg, providerLabel, providerOrg } from "../view-model";
import { OrgIcon } from "./org-icon";

/** `anthropic/claude-opus-5-5` as the Anthropic logo and `Opus 5.5`, with the full selector on hover. */
export function Model({ selector }: { selector: string }) {
	return (
		<span title={selector}>
			<OrgIcon org={modelOrg(selector)} label className="mr-1 inline-block align-[-0.125em]" />
			{modelLabel(selector)}
		</span>
	);
}

/** What a screen reader says for a selector: `Opus 5.5 from Cursor`, since the label leaves the provider to the logo. */
export const modelDescription = (selector: string): string =>
	`${modelLabel(selector)} from ${providerLabel(selector.slice(0, selector.indexOf("/")))}`;

/** A provider's group heading in a model list: its logo and its name. */
export function ProviderHeading({ provider }: { provider: string }) {
	return (
		<span className="flex items-center gap-1.5">
			<OrgIcon org={providerOrg(provider)} />
			{providerLabel(provider)}
		</span>
	);
}

/** One model in a list: the logo of the org that makes it, its label, then its id, muted, to tell apart models sharing a label. */
export function ModelRow({ selector, id, selected }: { selector: string; id: string; selected: boolean }) {
	return (
		<>
			<OrgIcon org={modelOrg(selector)} className="text-foreground" fallback={<span aria-hidden className="size-3 shrink-0" />} />
			<span className="max-w-[60%] shrink-0 truncate">{modelLabel(selector)}</span>
			<span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{id}</span>
			<Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
		</>
	);
}

interface ModelPickerProps {
	/** The session's `provider/id`, or `null` before it reports one. */
	current: string | null;
	/** The last list the server sent for this session, or `null` while none has arrived. */
	list: { models: ModelOption[]; error: string | null } | null;
	open: boolean;
	/** The parent refreshes the list from omp whenever the picker opens. */
	onOpenChange: (open: boolean) => void;
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
export function ModelPicker({ current, list, open, onOpenChange, onPick }: ModelPickerProps) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" trailingIcon={ChevronsUpDown} title={current ?? undefined} aria-label={`Choose model: ${current ? modelDescription(current) : "none selected"}`} active={open}>
					<span className="max-w-56 truncate">{current ? <Model selector={current} /> : "Choose model"}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0" onMouseDown={event => event.stopPropagation()}>
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
									<CommandGroup key={provider} heading={<ProviderHeading provider={provider} />}>
										{models.map(model => {
											const selector = `${model.provider}/${model.id}`;
											return (
												<CommandItem
													key={selector}
													value={selector}
													keywords={[modelLabel(selector), providerLabel(model.provider)]}
													title={selector}
													onSelect={() => {
														onOpenChange(false);
														if (selector !== current) onPick(model);
													}}
												>
													<ModelRow selector={selector} id={model.id} selected={selector === current} />
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
