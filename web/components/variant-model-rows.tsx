import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { VariantSpec } from "../../src/shared/comparisons";
import { selectorOf } from "../../src/shared/models";
import { Button } from "@/components/ui/button";
import type { DraftModelSelection } from "../use-draft-model";
import { ModelPicker, type ModelMenuOpen } from "./model-picker";

export interface VariantDraft extends VariantSpec {
	id: string;
}

interface VariantModelRowProps {
	row: VariantDraft;
	number: number;
	common: DraftModelSelection;
	disabled: boolean;
	removable: boolean;
	onChange: (row: VariantDraft) => void;
	onRemove: () => void;
}

function VariantModelRow({ row, number, common, disabled, removable, onChange, onRemove }: VariantModelRowProps) {
	const [open, setOpen] = useState<ModelMenuOpen | null>(null);
	const current = row.model ? selectorOf(row.model) : common.picker.current;
	const levels = common.levelsOf(current);
	return (
		<li className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
			<span className="mr-auto text-xs font-medium">Variant {number}</span>
			<ModelPicker
				current={current}
				unset="Common model"
				list={common.picker.list}
				open={open}
				onOpenChange={setOpen}
				onPick={model => onChange({ ...row, model, thinking: null })}
				disabled={disabled}
				effort={{
					current: row.thinking ?? common.thinking,
					levels,
					allowDefault: true,
					onPick: thinking => onChange({ ...row, thinking }),
				}}
			/>
			{row.model === null && row.thinking === null ? <span className="text-xs text-muted-foreground">Common selection</span> : (
				<Button variant="ghost" size="compact" disabled={disabled} onClick={() => onChange({ ...row, model: null, thinking: null })}>
					Use common selection
				</Button>
			)}
			{row.thinking === null && <span className="text-xs text-muted-foreground">Common effort{common.thinking ? ` · ${common.thinking}` : ""}</span>}
			<Button variant="ghost" size="icon-compact" aria-label={`Remove variant ${number}`} disabled={disabled || !removable} onClick={onRemove}>
				<X />
			</Button>
		</li>
	);
}

interface VariantModelRowsProps {
	rows: VariantDraft[];
	common: DraftModelSelection;
	disabled: boolean;
	onChange: (rows: VariantDraft[]) => void;
}

export function VariantModelRows({ rows, common, disabled, onChange }: VariantModelRowsProps) {
	return (
		<fieldset disabled={disabled} className="mb-3 space-y-2">
			<legend className="mb-2 text-sm font-medium">Variants</legend>
			<p className="text-xs text-muted-foreground">Each gets the same prompt and its own fresh branch and worktree. Model and effort inherit the common selection unless changed.</p>
			<ol className="space-y-2">
				{rows.map((row, index) => (
					<VariantModelRow
						key={row.id}
						row={row}
						number={index + 1}
						common={common}
						disabled={disabled}
						removable={rows.length > 2}
						onChange={next => onChange(rows.map(item => item.id === row.id ? next : item))}
						onRemove={() => onChange(rows.filter(item => item.id !== row.id))}
					/>
				))}
			</ol>
			<Button
				variant="ghost"
				size="compact"
				disabled={disabled}
				onClick={() => onChange([...rows, { id: crypto.randomUUID(), model: null, thinking: null }])}
			>
				<Plus /> Add variant
			</Button>
		</fieldset>
	);
}
