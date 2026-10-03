import { useCallback, useEffect, useState } from "react";
import type { ModelRole } from "../src/shared";
import { getJson } from "./api";

export interface RoleList {
	roles: ModelRole[];
	error: string | null;
}

/**
 * omp's model roles a session in `cwd` could switch to, `null` until the server first answers for `cwd`. `reload` reads
 * them again, keeping the last answer meanwhile, so an edit to `config.yml` or a login since shows on the next open.
 */
export function useModelRoles(cwd: string | null): { list: RoleList | null; reload: () => void } {
	const [read, setRead] = useState<{ cwd: string; list: RoleList } | null>(null);
	const [reads, setReads] = useState(0);
	useEffect(() => {
		if (cwd === null) return;
		const controller = new AbortController();
		getJson<{ roles: ModelRole[] }>(`/api/models/roles?cwd=${encodeURIComponent(cwd)}`, controller.signal).then(
			({ roles }) => setRead({ cwd, list: { roles, error: null } }),
			(err: unknown) => {
				if (!controller.signal.aborted) setRead({ cwd, list: { roles: [], error: err instanceof Error ? err.message : String(err) } });
			},
		);
		return () => controller.abort();
	}, [cwd, reads]);
	const reload = useCallback(() => setReads(count => count + 1), []);
	return { list: read?.cwd === cwd ? read.list : null, reload };
}

/** The first role naming `model` (`provider/id`) and, when its selector names a level, `thinking`; `null` when none does. */
export function roleOf(roles: ModelRole[], model: string | null, thinking: string | null): ModelRole | null {
	return roles.find(role => `${role.model.provider}/${role.model.id}` === model && (role.thinking === null || role.thinking === thinking)) ?? null;
}
