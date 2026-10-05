import type { ModelOption } from "../../src/shared";
import { Brain } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabItem, TabPanel } from "@/components/ui/tabs";
import { modelLabel, modelOrg, providerLabel, providerOrg } from "../labels";
import { CommandPicker, fromList, type PickerGroup } from "./command-picker";
import { OrgIcon } from "./org-icon";
import { ThinkingChoices, type ThinkingChoicesProps } from "./thinking-picker";

/**
 * `anthropic/claude-opus-5-5` as the Anthropic logo and `Opus 5.5`, with the full selector on hover. `titled={false}`
 * drops the hover and the logo's name, for a trigger whose tooltip and aria-label already say them.
 */
export function Model({ selector, titled = true }: { selector: string; titled?: boolean }) {
	return (
		<span title={titled ? selector : undefined}>
			<OrgIcon org={modelOrg(selector)} label={titled} className="mr-1 inline-block align-[-0.125em]" />
			{modelLabel(selector)}
		</span>
	);
}

/** What a screen reader says for a selector: `Opus 5.5 from Cursor`, since the label leaves the provider to the logo. */
export const modelDescription = (selector: string): string =>
	`${modelLabel(selector)} from ${providerLabel(selector.slice(0, selector.indexOf("/")))}`;

/** A provider's group heading in a model list: its logo and its name. */
function ProviderHeading({ provider }: { provider: string }) {
	return (
		<span className="flex items-center gap-1.5">
			<OrgIcon org={providerOrg(provider)} />
			{providerLabel(provider)}
		</span>
	);
}

/** One model in a list: the logo of the org that makes it, its label, then its id, muted, to tell apart models sharing a label. */
function ModelRow({ selector, id }: { selector: string; id: string }) {
	return (
		<>
			<OrgIcon org={modelOrg(selector)} className="text-foreground" fallback={<span aria-hidden className="size-3 shrink-0" />} />
			<span className="max-w-[60%] shrink-0 truncate">{modelLabel(selector)}</span>
			<span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{id}</span>
		</>
	);
}

/** The search field, no-match line, and loading line every model list shares. */
export const MODEL_LIST = { search: { label: "Search models" }, empty: "No model matches.", loading: "Loading models…" } as const;

/**
 * Models grouped by provider as picker groups, each under its {@link ProviderHeading} and drawn as a {@link ModelRow},
 * checked when its selector is `current`. `describe` names a model's selector, its id, and one more word to search by.
 */
export function modelGroups<T>(
	byProvider: [string, T[]][],
	describe: (model: T) => { selector: string; id: string; keyword: string },
	current: string | null,
	onPick: (model: T) => void,
): PickerGroup[] {
	return byProvider.map(([provider, models]) => ({
		key: provider,
		heading: <ProviderHeading provider={provider} />,
		items: models.map(model => {
			const { selector, id, keyword } = describe(model);
			return {
				value: selector,
				label: <ModelRow selector={selector} id={id} />,
				keywords: [modelLabel(selector), keyword],
				title: selector,
				ariaLabel: `${modelDescription(selector)}, ${id}`,
				selected: selector === current,
				onSelect: () => onPick(model),
			};
		}),
	}));
}

interface ModelPickerProps {
	/** The session's `provider/id`, or `null` before it reports one or, in the new-session draft, before you pick one. */
	current: string | null;
	/** What the button reads while `current` is `null`, `Choose model` when not given. */
	unset?: string;
	/** The last list the server sent, or `null` while none has arrived. */
	list: { models: ModelOption[]; error: string | null } | null;
	open: boolean;
	/** The parent refreshes the list from omp whenever the picker opens. */
	onOpenChange: (open: boolean) => void;
	onPick: (model: ModelOption) => void;
	disabled?: boolean;
	thinking: ThinkingChoicesProps;
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

const selectorOf = (model: ModelOption): string => `${model.provider}/${model.id}`;

/** Provider tabs filter the models without changing the session's active model. */
export function ModelPicker({ current, unset, list, open, onOpenChange, onPick, disabled, thinking }: ModelPickerProps) {
	const [provider, setProvider] = useState<string | null>(null);
	const groups = byProvider(list?.models ?? []);
	const currentProvider = current?.slice(0, current.indexOf("/")) ?? null;
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) setProvider(currentProvider);
		wasOpen.current = open;
	}, [open, currentProvider]);
	const active = groups.find(([name]) => name === provider)?.[0] ?? groups.find(([name]) => name === currentProvider)?.[0] ?? groups[0]?.[0] ?? "";
	const changeOpen = (next: boolean): void => {
		if (next) setProvider(currentProvider);
		onOpenChange(next);
	};
	return (
		<CommandPicker
			trigger={
				<span className="flex min-w-0 items-center gap-2">
					<span className="max-w-56 truncate">{current ? <Model selector={current} titled={false} /> : (unset ?? "Choose model")}</span>
					{thinking.current && (
						<span className="flex shrink-0 items-center gap-1 text-muted-foreground">
							<Brain aria-hidden="true" className="size-3.5" />
							{thinking.current}
						</span>
					)}
				</span>
			}
			tooltip={current ?? unset ?? "Choose model"}
			shortcut="model"
			ariaLabel={`Choose model and thinking level: ${current ? modelDescription(current) : (unset ?? "none selected")}, thinking ${thinking.current ?? "Default"}`}
			disabled={disabled}
			selectionDisabled={thinking.pending}
			search={MODEL_LIST.search}
			width="lg"
			side="top"
			open={open}
			onOpenChange={changeOpen}
			closeOnSelect={false}
			list={fromList(list, MODEL_LIST.loading, () =>
				modelGroups(
					groups.filter(([name]) => name === active),
					model => ({ selector: selectorOf(model), id: model.id, keyword: providerLabel(model.provider) }),
					current,
					model => {
						if (!disabled && !thinking.pending && selectorOf(model) !== current) onPick(model);
					},
				),
			)}
			empty={list?.models.length === 0 ? "No connected models. Sign in to a provider in omp, then reopen this picker." : MODEL_LIST.empty}
			content={command => (
				<>
					{groups.length > 0 && !list?.error ? (
						<Tabs value={active} onValueChange={setProvider} size="compact">
							<div className="max-w-full overflow-x-auto p-2">
								<TabsList aria-label="Model providers" className="w-max min-w-full">
									{groups.map(([name]) => (
										<TabItem key={name} value={name} label={providerLabel(name)} onFocus={event => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })} />
									))}
								</TabsList>
							</div>
							{groups.map(([name]) => (
								<TabPanel key={name} value={name}>{name === active ? command : null}</TabPanel>
							))}
						</Tabs>
					) : command}
					<ThinkingChoices {...thinking} disabled={disabled || thinking.disabled} />
				</>
			)}
		/>
	);
}
