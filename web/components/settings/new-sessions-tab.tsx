import { Sparkles } from "lucide-react";
import { usePinnedSkill } from "../../pinned-skill";
import { useSkills } from "../../use-skills";
import { CommandPicker, fromList } from "../command-picker";
import { Section } from "./editor";

/**
 * The skill every session the dashboard starts goes through, kept in this browser. It lists the skills of `cwd`, the
 * workspace the settings show, else the user's own.
 */
export function NewSessionsTab({ cwd }: { cwd: string | null }) {
	const [pinned, pin] = usePinnedSkill();
	const skills = useSkills(cwd ?? "~");
	return (
		<Section
			title="Pinned skill"
			meta="The first message of every session you start here, a quick action's included, goes through this skill. Saved in this browser."
		>
			<CommandPicker
				trigger={<span className="max-w-64 truncate">{pinned ?? "None"}</span>}
				icon={Sparkles}
				ariaLabel={`Pinned skill: ${pinned ?? "none"}`}
				search={{ label: "Search skills" }}
				width="lg"
				list={fromList(skills, "Loading skills…", ({ skills }) => [
					{ key: "none", items: [{ value: "None", label: "None", selected: pinned === null, onSelect: () => pin(null) }] },
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
							selected: skill.name === pinned,
							onSelect: () => pin(skill.name),
						})),
					},
				])}
				empty="No skill matches."
			/>
			{pinned !== null && skills.error === null && skills.data && !skills.data.skills.some(skill => skill.name === pinned) && (
				<p className="text-xs text-muted-foreground">No skill named {pinned} here. A session in a directory without it starts without it.</p>
			)}
		</Section>
	);
}
