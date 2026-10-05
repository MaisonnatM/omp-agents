import type { SkillOption } from "../src/shared";
import { useCwdRead } from "./use-cwd-read";

export interface SkillList {
	skills: SkillOption[];
	error: string | null;
}

/** The skills a session started in `cwd` can invoke, `null` until the server first answers for `cwd`. */
export function useSkills(cwd: string): SkillList | null {
	const read = useCwdRead<{ skills: SkillOption[] }>("/api/skills", cwd);
	return read && (read.ok ? { skills: read.value.skills, error: null } : { skills: [], error: read.error });
}
