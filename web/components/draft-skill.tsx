import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePinnedSkill } from "../pinned-skill";
import { useSkills } from "../use-skills";

type SkillState = "on" | "off" | "missing" | "bypassed";

export function useDraftSkill(cwd: string, draft: string, initial?: { skill: string | null }) {
	const [pinnedSkill] = usePinnedSkill();
	const name = initial?.skill ?? pinnedSkill;
	const [skip, setSkip] = useState(initial !== undefined && initial.skill === null);
	const skills = useSkills(cwd);
	const listed = skills.error === null ? skills.data?.skills : [];
	const state: SkillState = listed && !listed.some(skill => skill.name === name)
		? "missing"
		: skip ? "off" : draft.trimStart().startsWith("/") ? "bypassed" : "on";
	return { name, state, skill: skip ? null : name, toggle: () => setSkip(value => !value) };
}

function skillTitle(name: string, state: SkillState): string {
	switch (state) {
		case "on":
			return `The first message goes through /skill:${name}. Click to start without it.`;
		case "off":
			return `Click to send the first message through /skill:${name}.`;
		case "missing":
			return `No skill named ${name} in this directory, so the session starts without it.`;
		case "bypassed":
			return `A message that starts with / runs its own command, so it skips /skill:${name}.`;
	}
}

export function SkillToggle({ name, state, onToggle, disabled }: { name: string; state: SkillState; onToggle: () => void; disabled: boolean }) {
	return (
		<Tooltip content={skillTitle(name, state)}>
			<Button
				variant="ghost"
				size="compact"
				leadingIcon={Sparkles}
				aria-pressed={state === "on"}
				aria-label={`Skill ${name}`}
				onClick={onToggle}
				disabled={disabled || state === "missing" || state === "bypassed"}
			>
				<span className={cn("max-w-40 truncate", state !== "on" && "text-muted-foreground line-through")}>{name}</span>
			</Button>
		</Tooltip>
	);
}
