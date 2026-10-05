import { Sparkles } from "lucide-react";
import type { SkillOption } from "../../src/shared";
import type { ReadState } from "../reads";
import { CommandPicker, fromList } from "./command-picker";

interface SkillPickerProps {
	/** What the picker sets, for its accessible name: `Pinned skill`. */
	label: string;
	/** The skills to offer, from `useSkills`. */
	skills: ReadState<{ skills: SkillOption[] }>;
	/** `null` for none. */
	value: string | null;
	onPick: (skill: string | null) => void;
}

/** A searchable list of `skills`, after **None**. */
export function SkillPicker({ label, skills, value, onPick }: SkillPickerProps) {
	return (
		<CommandPicker
			trigger={<span className="max-w-64 truncate">{value ?? "None"}</span>}
			icon={Sparkles}
			ariaLabel={`${label}: ${value ?? "none"}`}
			tooltip={value ?? "Choose a skill"}
			search={{ label: "Search skills" }}
			width="lg"
			list={fromList(skills, "Loading skills…", ({ skills }) => [
				{ key: "none", items: [{ value: "None", label: "None", selected: value === null, onSelect: () => onPick(null) }] },
				{
					key: "skills",
					heading: "Skills",
					items: skills.map(skill => ({
						value: skill.name,
						label: (
							<>
								<span className="shrink-0">{skill.name}</span>
								{skill.description && <span className="min-w-0 truncate text-xs text-muted-foreground">{skill.description}</span>}
							</>
						),
						selected: skill.name === value,
						onSelect: () => onPick(skill.name),
					})),
				},
			])}
			empty="No skill matches."
		/>
	);
}
