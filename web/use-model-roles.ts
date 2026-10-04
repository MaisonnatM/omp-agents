import { useCallback, useState } from "react";
import type { ModelRole } from "../src/shared";
import { useRead } from "./reads";

export interface RoleList {
	roles: ModelRole[];
	error: string | null;
}

/**
 * omp's model roles a session in `cwd` could switch to, `null` until the server first answers for `cwd`. `reload` reads
 * them again, keeping the last answer meanwhile, so an edit to `config.yml` or a login since shows on the next open.
 */
export function useModelRoles(cwd: string | null): { list: RoleList | null; reload: () => void } {
	const [reads, setReads] = useState(0);
	const read = useRead<{ roles: ModelRole[] }>(cwd === null ? null : `/api/models/roles?cwd=${encodeURIComponent(cwd)}`, reads);
	const reload = useCallback(() => setReads(count => count + 1), []);
	return { list: read.error !== null ? { roles: [], error: read.error } : read.data && { roles: read.data.roles, error: null }, reload };
}

/**
 * The role naming `model` (`provider/id`) and, when its selector names a level, `thinking`; `null` when none does.
 * Several roles often name the same model (`default`, `plan`, and `slow` on one Opus), so `picked`, the role picked
 * last, wins while it still matches; otherwise the first in config order does.
 */
export function roleOf(roles: ModelRole[], model: string | null, thinking: string | null, picked: string | null): ModelRole | null {
	const matches = roles.filter(role => `${role.model.provider}/${role.model.id}` === model && (role.thinking === null || role.thinking === thinking));
	return matches.find(role => role.role === picked) ?? matches[0] ?? null;
}
