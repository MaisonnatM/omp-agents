import type { SkillOption } from "../src/shared";
import { type ReadState, useRead } from "./reads";

/** The skills a session started in `cwd` can invoke, as the server answers for `cwd`. */
export const useSkills = (cwd: string): ReadState<{ skills: SkillOption[] }> => useRead(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
