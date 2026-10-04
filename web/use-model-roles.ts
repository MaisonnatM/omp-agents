import { useCallback, useState } from "react";
import type { ModelRole } from "../src/shared";
import { useCwdRead } from "./use-cwd-read";

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
	const read = useCwdRead<{ roles: ModelRole[] }>("/api/models/roles", cwd, reads);
	const reload = useCallback(() => setReads(count => count + 1), []);
	return { list: read && (read.ok ? { roles: read.value.roles, error: null } : { roles: [], error: read.error }), reload };
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
