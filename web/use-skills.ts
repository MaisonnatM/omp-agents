import type { SkillOption } from "../src/shared";
import { useRead } from "./reads";

export interface SkillList {
	skills: SkillOption[];
	error: string | null;
}

/** The skills a session started in `cwd` can invoke, `null` until the server first answers for `cwd`. */
export function useSkills(cwd: string): SkillList | null {
	const read = useRead<{ skills: SkillOption[] }>(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
	return read.error !== null ? { skills: [], error: read.error } : read.data && { skills: read.data.skills, error: null };
}
