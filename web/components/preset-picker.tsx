import { SlidersHorizontal } from "lucide-react";
import type { SessionPreset } from "../../src/shared/presets";
import { selectorOf } from "../../src/shared/models";
import { CommandPicker } from "./command-picker";

/** What `preset` starts with, in a line: its model, its tools, its skill, and its branch. */
export function presetSummary(preset: SessionPreset): string {
	const parts = [
		preset.model ? selectorOf(preset.model) + (preset.thinking ? `:${preset.thinking}` : "") : "Default model",
		preset.tools ? `${preset.tools.length === 1 ? "1 tool" : `${preset.tools.length} tools`} allowed: ${preset.tools.join(", ")}` : "Every tool",
		preset.skill ? `/skill:${preset.skill}` : "No skill",
		preset.worktree === "new-branch" ? "New branch" : "This directory",
	];
	return parts.join(" · ");
}

interface PresetPickerProps {
	presets: SessionPreset[];
	/** The preset picked, `null` for none. */
	value: SessionPreset | null;
	onPick: (preset: SessionPreset | null) => void;
	disabled?: boolean;
	/** Which side of the trigger the list opens on; the composer's pickers open upward. */
	side?: "top" | "bottom";
}

/** A list of the presets, after **No preset**, each with what it starts with. */
export function PresetPicker({ presets, value, onPick, disabled, side }: PresetPickerProps) {
	return (
		<CommandPicker
			trigger={<span className="max-w-40 truncate">{value?.name ?? "No preset"}</span>}
			icon={SlidersHorizontal}
			ariaLabel={`Preset: ${value?.name ?? "none"}`}
			tooltip={value ? presetSummary(value) : "Choose a preset"}
			disabled={disabled}
			width="lg"
			side={side}
			list={{
				kind: "ready",
				groups: [
					{ key: "none", items: [{ value: "No preset", label: "No preset", selected: value === null, onSelect: () => onPick(null) }] },
					{
						key: "presets",
						heading: "Presets",
						items: presets.map(preset => ({
							value: `${preset.name} ${preset.id}`,
							label: (
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{preset.name}</span>
									<span className="truncate text-xs text-muted-foreground">{presetSummary(preset)}</span>
								</span>
							),
							selected: preset.id === value?.id,
							onSelect: () => onPick(preset),
						})),
					},
				],
			}}
		/>
	);
}
