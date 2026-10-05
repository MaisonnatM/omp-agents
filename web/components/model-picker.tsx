import type { ModelOption } from "../../src/shared";
import { modelLabel, modelOrg, providerLabel, providerOrg } from "../labels";
import { CommandPicker, fromList, type PickerGroup } from "./command-picker";
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

/** The composer's model switch: a searchable list of the models of the providers you are connected to, grouped by provider. */
export function ModelPicker({ current, unset, list, open, onOpenChange, onPick, disabled }: ModelPickerProps) {
	return (
		<CommandPicker
			trigger={<span className="max-w-56 truncate">{current ? <Model selector={current} /> : (unset ?? "Choose model")}</span>}
			title={current ?? undefined}
			ariaLabel={`Choose model: ${current ? modelDescription(current) : (unset ?? "none selected")}`}
			disabled={disabled}
			search={MODEL_LIST.search}
			width="lg"
			side="top"
			open={open}
			onOpenChange={onOpenChange}
			list={fromList(list, MODEL_LIST.loading, ({ models }) =>
				modelGroups(
					byProvider(models),
					model => ({ selector: selectorOf(model), id: model.id, keyword: providerLabel(model.provider) }),
					current,
					model => {
						if (selectorOf(model) !== current) onPick(model);
					},
				),
			)}
			empty={MODEL_LIST.empty}
		/>
	);
}
