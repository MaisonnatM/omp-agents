/**
 * The model role picked last for each dashboard session, by instance id, which a session's model alone cannot tell when
 * several roles name it. The new-session draft hands its pick over at the start, and a live view keeps its picks here,
 * so a pane that opens the session again shows the same role. The page forgets them on reload.
 */
const picked = new Map<string, string>();

export const pickedRoleOf = (instanceId: string): string | null => picked.get(instanceId) ?? null;

export function rememberPickedRole(instanceId: string, role: string | null): void {
	if (role === null) picked.delete(instanceId);
	else picked.set(instanceId, role);
}
