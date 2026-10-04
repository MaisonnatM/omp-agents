import { Brain } from "lucide-react";
import { CommandPicker } from "./command-picker";

interface ThinkingPickerProps {
	/** omp's thinking level, or `null` before the session reports one. */
	current: string | null;
	/** Levels the session's model accepts, `off` first. */
	levels: string[];
	onPick: (level: string) => void;
}

/** The composer's thinking-level switch: omp's levels for the current model, lowest first. */
export function ThinkingPicker({ current, levels, onPick }: ThinkingPickerProps) {
	return (
		<CommandPicker
			trigger={current ?? "Thinking"}
			icon={Brain}
			ariaLabel={`Choose thinking level: ${current ?? "none selected"}`}
			width="sm"
			side="top"
			list={{
				kind: "ready",
				groups: [
					{
						key: "levels",
						heading: "Thinking level",
						items: levels.map(level => ({
							value: level,
							label: level,
							selected: level === current,
							onSelect: () => {
								if (level !== current) onPick(level);
							},
						})),
					},
				],
			}}
		/>
	);
}
