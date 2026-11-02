/** A Settings model selector and its thinking level, with optional role aliases for agent defaults. */
import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { splitSelector, type CatalogModel } from "../../../src/shared/models";
import { CommandPicker, fromList } from "../command-picker";
import { MODEL_LIST, Model, modelDescription, modelGroups } from "../model-picker";
import type { Catalog } from "./editor";

export function SelectorPicker({ value, catalog, label, labelId, roles = [], disabled, onPick }: { value: string | null; catalog: Catalog; label: string; labelId?: string; roles?: string[]; disabled?: boolean; onPick: (selector: string) => void }) {
	const models = catalog.data?.bySelector ?? null;
	const { model, level } = value && models ? splitSelector(value, models) : { model: value, level: null };
	const valueId = useId();
	const valueName = `${label}: ${model ? model.startsWith("@") ? `${model} model role` : modelDescription(model) : "none"}`;
	const levels = (model && models?.get(model)?.thinking) || [];
	const pickModel = (next: CatalogModel): void => onPick(level && next.thinking.includes(level) ? `${next.selector}:${level}` : next.selector);
	const list = fromList(catalog, MODEL_LIST.loading, ({ byProvider }) => modelGroups(byProvider, option => ({ selector: option.selector, id: option.selector.slice(option.provider.length + 1), keywords: [option.name] }), model, pickModel));
	const roleGroup = { key: "roles", heading: "Model roles", items: roles.map(role => ({ value: `role:${role}`, label: `@${role}`, selected: value === `@${role}`, onSelect: () => onPick(`@${role}`) })) };
	const groups = roles.length ? [roleGroup] : [];
	const choices = list.kind === "ready" ? { kind: "ready" as const, groups: [...groups, ...list.groups] } : groups.length ? { kind: "ready" as const, groups } : list;
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1">
			<span id={valueId} className="sr-only">{valueName}</span>
			<CommandPicker
				trigger={<span className="max-w-56 truncate">{model ? <Model selector={model} titled={false} /> : "Choose a model"}</span>}
				ariaLabelledby={[labelId, valueId].filter(Boolean).join(" ")}
				tooltip={model ? `Model for ${label}: ${modelDescription(model)}` : `Choose a model for ${label}`}
				className="min-w-0" disabled={disabled} search={MODEL_LIST.search} width="lg" list={choices} empty={MODEL_LIST.empty}
			/>
			{model && (levels.length > 0 || level) && (
				<Select value={level ?? ""} disabled={disabled} onValueChange={next => onPick(next ? `${model}:${next}` : model)}>
					<Tooltip content={`Thinking level for ${label}`}>
						<SelectTrigger aria-label={`${label}: thinking level`}><SelectValue>{(value: string) => value || "default"}</SelectValue></SelectTrigger>
					</Tooltip>
					<SelectContent>
						<SelectItem value="">default</SelectItem>
						{[...new Set([...levels, ...(level ? [level] : [])])].map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
					</SelectContent>
				</Select>
			)}
		</div>
	);
}
