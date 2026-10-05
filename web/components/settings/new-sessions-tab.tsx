import { usePinnedSkill } from "../../pinned-skill";
import { useSkills } from "../../use-skills";
import { SkillPicker } from "../skill-picker";
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
			<SkillPicker label="Pinned skill" skills={skills} value={pinned} onPick={pin} />
			{pinned !== null && skills.error === null && skills.data && !skills.data.skills.some(skill => skill.name === pinned) && (
				<p className="text-xs text-muted-foreground">No skill named {pinned} here. A session in a directory without it starts without it.</p>
			)}
		</Section>
	);
}
