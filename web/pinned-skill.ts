import { useState } from "react";

const PINNED_SKILL_KEY = "omp-agents.pinned-skill";

/** The skill pinned in the settings, which every session the dashboard starts invokes with its first message; `null` for none. */
export const readPinnedSkill = (): string | null => localStorage.getItem(PINNED_SKILL_KEY);

/** The pinned skill and its setter, which keeps it in this browser's localStorage. */
export function usePinnedSkill(): [string | null, (skill: string | null) => void] {
	const [skill, setSkill] = useState(readPinnedSkill);
	const pin = (next: string | null): void => {
		setSkill(next);
		if (next === null) localStorage.removeItem(PINNED_SKILL_KEY);
		else localStorage.setItem(PINNED_SKILL_KEY, next);
	};
	return [skill, pin];
}
