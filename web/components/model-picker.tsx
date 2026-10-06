import { type ModelEntry, type ModelOption, type PlanUsage, selectorOf } from "../../src/shared/models";
import type { FastMode } from "../../src/shared/sessions";
import { ChevronDown } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSubmenu,
	MenuSubmenuContent,
	MenuSubmenuTrigger,
	MenuSwitchItem,
} from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { modelLabel, modelOrg, providerLabel, providerOrg } from "../labels";
import { contextVariants, levelLabel, modelMatch, providerQuota } from "../model-menu";
import type { ModelList } from "../reads";
import { shortcutLabels } from "../shortcuts";
import { CommandResults, type PickerGroup, type PickerList } from "./command-picker";
import { OrgIcon } from "./org-icon";
import { NO_PLANS, Plans } from "./plan-usage";

/**
 * `anthropic/claude-opus-5-5` as the Anthropic logo and `Opus 5.5`, with the full selector on hover. `titled={false}`
 * drops the hover and the logo's name, for a trigger whose tooltip and aria-label already say them.
 */
export function Model({ selector, titled = true }: { selector: string; titled?: boolean }) {
	return (
		<span>
			{titled ? (
				<Tooltip content={selector}>
					<span>
						<OrgIcon org={modelOrg(selector)} label className="mr-1 inline-block align-[-0.125em]" />
						{modelLabel(selector)}
					</span>
				</Tooltip>
			) : (
				<>
					<OrgIcon org={modelOrg(selector)} className="mr-1 inline-block align-[-0.125em]" />
					{modelLabel(selector)}
				</>
			)}
		</span>
	);
}

/** What a screen reader says for a selector: `Opus 5.5 from Cursor`, since the label leaves the provider to the logo. */
export const modelDescription = (selector: string): string =>
	`${modelLabel(selector)} from ${providerLabel(selector.slice(0, selector.indexOf("/")))}`;

/** A provider's group heading in a model list: its logo and its name, then how much of its plan is used, when `plans` has it. */
function ProviderHeading({ provider, plans = NO_PLANS }: { provider: string; plans?: readonly PlanUsage[] }) {
	const quota = providerQuota(plans, provider);
	return (
		<span className="flex w-full items-center gap-1.5">
			<OrgIcon org={providerOrg(provider)} />
			{providerLabel(provider)}
			{quota && (
				<span className="ml-auto tabular-nums" title={quota.windows.map(window => `${quota.account}: ${window.title}: ${Math.round((1 - window.remaining) * 100)}% used`).join("\n")}>
					{Math.round(quota.used * 100)}% used
				</span>
			)}
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
 * checked when its selector is `current`. `describe` names a model's selector, its id, and the extra words to search by.
 * `plans` puts each provider's quota on its heading.
 */
export function modelGroups<T>(
	byProvider: ReadonlyMap<string, T[]>,
	describe: (model: T) => { selector: string; id: string; keywords: string[] },
	current: string | null,
	onPick: (model: T) => void,
	plans?: readonly PlanUsage[],
): PickerGroup[] {
	return Array.from(byProvider, ([provider, models]) => ({
		key: provider,
		heading: <ProviderHeading provider={provider} plans={plans} />,
		items: models.map(model => {
			const { selector, id, keywords } = describe(model);
			return {
				value: selector,
				label: <ModelRow selector={selector} id={id} />,
				keywords: [modelLabel(selector), ...keywords],
				title: selector,
				ariaLabel: `${modelDescription(selector)}, ${id}`,
				selected: selector === current,
				onSelect: () => onPick(model),
			};
		}),
	}));
}

/** Which part of the model menu is open: the menu, or the menu with its model search beside it. */
export type ModelMenuOpen = "menu" | "models";

export interface EffortChoices {
	/** The chosen level, `null` for omp's default. */
	current: string | null;
	/** The levels the model takes, `null` until its capabilities are known. */
	levels: string[] | null;
	onPick: (level: string | null) => void;
	/** Offers `Default`, which leaves the level to omp. */
	allowDefault?: boolean;
}

interface ModelPickerProps {
	/** The session's `provider/id`, or `null` before it reports one or, in the new-session draft, before you pick one. */
	current: string | null;
	/** What the button reads while `current` is `null`, `Choose model` when not given. */
	unset?: string;
	/** The models the server last sent for this session; nothing while none has arrived. */
	list: ModelList;
	/** `null` while closed. */
	open: ModelMenuOpen | null;
	/** The parent refreshes the list from omp whenever the menu opens. */
	onOpenChange: (open: ModelMenuOpen | null) => void;
	onPick: (model: ModelOption) => void;
	disabled?: boolean;
	/** A model switch is under way, so nothing else switches until it lands. */
	pending?: boolean;
	effort: EffortChoices;
	/** omp's `/fast` for a live session, `state` `null` while its model has no fast tier; the draft has no row. */
	fast?: { state: FastMode | null; onChange: (enabled: boolean) => void };
}

/** `Default` among the effort choices; omp's own levels are never empty. */
const DEFAULT_LEVEL = "";

/** @base-ui/react 1.8.0 Menu.SubmenuRoot's onOpenChange details.reason: these closes
 * navigate to the parent. Item selection closes the outer menu instead. */
const BACK_TO_MENU: Record<string, true> = { "trigger-hover": true, "sibling-open": true, "list-navigation": true, "escape-key": true, "trigger-press": true };

/** `300K` and `1M`, as model ids name their context sizes, whatever the browser's locale. */
const tokens = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Cursor's model menu: Fast, Context, and Effort for the current model, then Model, which searches every connected model. */
export function ModelPicker({ current, unset = "Choose model", list, open, onOpenChange, onPick, disabled, pending = false, effort, fast }: ModelPickerProps) {
	const models = list.data?.models ?? [];
	const variants = contextVariants(models, current);
	const contextWindow = variants.find(model => selectorOf(model) === current)?.contextWindow ?? null;
	const levels = effort.levels ?? [];
	const effortValue = pending ? "Switching…" : effort.levels === null ? "Unavailable" : levels.length === 0 ? "None" : effort.current ? levelLabel(effort.current) : "Default";
	const pick = ({ provider, id }: ModelOption): void => {
		onOpenChange(null);
		if (!disabled && !pending && `${provider}/${id}` !== current) onPick({ provider, id });
	};
	// Opened together, the menu would focus its Model row after the search field took the keys; the search waits for it.
	const [menuShown, setMenuShown] = useState(false);
	return (
		<DropdownMenu open={open !== null} onOpenChange={next => onOpenChange(next ? "menu" : null)} onOpenChangeComplete={setMenuShown}>
			<Tooltip content={current ?? unset} shortcut={shortcutLabels("model")} side="top" forceOpen={open !== null ? false : undefined} disabled={disabled}>
				<DropdownMenuTrigger
					disabled={disabled}
					render={
						<Button
							variant="ghost"
							size="compact"
							trailingIcon={ChevronDown}
							aria-label={`Choose model and effort: ${current ? modelDescription(current) : unset}, effort ${effort.current ? levelLabel(effort.current) : "Default"}`}
							active={open !== null}
						/>
					}
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="max-w-56 truncate">{current ? <Model selector={current} titled={false} /> : unset}</span>
						{effort.current && <span className="shrink-0 text-muted-foreground">{levelLabel(effort.current)}</span>}
					</span>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent side="top" className="w-64">
				{fast && (
					<MenuSwitchItem
						checked={fast.state?.enabled ?? false}
						onCheckedChange={fast.onChange}
						disabled={pending || fast.state === null}
						title={fast.state === null ? "This model has no fast tier." : "omp's /fast: priority service, at a higher price."}
					>
						Fast
						{fast.state?.enabled && !fast.state.active && <span className="text-xs text-muted-foreground">not active</span>}
					</MenuSwitchItem>
				)}
				{contextWindow !== null && (
					<MenuSubmenu>
						<MenuSubmenuTrigger disabled={pending} value={tokens.format(contextWindow)}>
							Context
						</MenuSubmenuTrigger>
						<MenuSubmenuContent>
							<MenuRadioGroup
								value={current}
								onValueChange={(selector: string) => {
									const variant = variants.find(model => selectorOf(model) === selector);
									if (variant) pick(variant);
								}}
							>
								{variants.map(model => (
									<MenuRadioItem key={model.id} value={selectorOf(model)} closeOnClick>
										{tokens.format(model.contextWindow ?? 0)}
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
						</MenuSubmenuContent>
					</MenuSubmenu>
				)}
				<MenuSubmenu>
					<MenuSubmenuTrigger disabled={pending || levels.length === 0} value={effortValue} title={`Thinking level (${shortcutLabels("thinking").join(" or ")} cycles it)`}>
						Effort
					</MenuSubmenuTrigger>
					<MenuSubmenuContent>
						<MenuRadioGroup value={effort.current ?? DEFAULT_LEVEL} onValueChange={(level: string) => effort.onPick(level === DEFAULT_LEVEL ? null : level)}>
							{effort.allowDefault && (
								<MenuRadioItem value={DEFAULT_LEVEL} closeOnClick>
									Default
								</MenuRadioItem>
							)}
							{levels.map(level => (
								<MenuRadioItem key={level} value={level} closeOnClick>
									{levelLabel(level)}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubmenuContent>
				</MenuSubmenu>
				<MenuSeparator />
				<MenuSubmenu
					open={open === "models" && menuShown}
					onOpenChange={(next, details) => {
						if (next) onOpenChange("models");
						else if (BACK_TO_MENU[details.reason]) onOpenChange("menu");
					}}
				>
					<MenuSubmenuTrigger value={current ? modelLabel(current) : unset}>Model</MenuSubmenuTrigger>
					<MenuSubmenuContent className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden p-0">
						<ModelSearch list={list} current={current} disabled={disabled || pending} onPick={pick} />
					</MenuSubmenuContent>
				</MenuSubmenu>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Before you type, the models your roles and fallback chains name plus the current one; typing searches every connected model. */
function ModelSearch({ list, current, disabled, onPick }: { list: ModelList; current: string | null; disabled?: boolean; onPick: (model: ModelEntry) => void }) {
	const plans = useContext(Plans);
	const [query, setQuery] = useState("");
	const input = useRef<HTMLInputElement>(null);
	// The menu focuses its popup as the submenu opens; the search field takes the keys after it, as Cursor's does.
	useEffect(() => {
		const frame = requestAnimationFrame(() => input.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);
	const models = list.data?.models ?? [];
	const shown = query.trim() === "" ? models.filter(model => model.curated || selectorOf(model) === current) : models;
	const results: PickerList = list.error
		? { kind: "failed", error: list.error }
		: list.data === null
			? { kind: "loading", message: MODEL_LIST.loading }
			: {
					kind: "ready",
					groups: modelGroups(
						Map.groupBy(shown, model => model.provider),
						model => ({ selector: selectorOf(model), id: model.id, keywords: [model.name, providerLabel(model.provider)] }),
						current,
						onPick,
						plans,
					),
				};
	return (
		<CommandResults
			search={{ label: MODEL_LIST.search.label, query: { value: query, onChange: setQuery }, ref: input }}
			list={results}
			empty={models.length === 0 ? "No connected models. Sign in to a provider in omp, then reopen this menu." : MODEL_LIST.empty}
			selectionDisabled={disabled}
			closeOnSelect={false}
			filter={modelMatch}
			listClassName="max-h-80"
			// Base UI's menu would read typed letters as type-ahead and arrows as its own navigation; Escape still closes the submenu.
			onKeyDown={event => {
				if (event.key !== "Escape") event.stopPropagation();
			}}
		/>
	);
}
