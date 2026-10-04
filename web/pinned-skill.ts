import { useStoredState } from "./stored-state";

const PINNED_SKILL_KEY = "omp-agents.pinned-skill";

const decodeSkill = (raw: string | null): string | null => raw || null;

/** The skill pinned in the settings, which every session the dashboard starts invokes with its first message; `null` for none. */
export const readPinnedSkill = (): string | null => decodeSkill(localStorage.getItem(PINNED_SKILL_KEY));

/** The pinned skill and its setter, which keeps it in this browser's localStorage. */
export const usePinnedSkill = (): [string | null, (skill: string | null) => void] =>
	useStoredState(PINNED_SKILL_KEY, decodeSkill, skill => skill ?? "");
