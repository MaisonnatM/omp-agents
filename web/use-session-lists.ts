import { useCallback, useMemo, useRef, useState } from "react";
import { latestSession, listedViews, searchSessions, type SidebarSessions, sidebarSessions, waitingCount, type WorkspaceGroup, workspaceGroups } from "./sessions";
import type { PinChange } from "../src/shared/pins";
import type { View } from "../src/shared/sessions";
import type { WorkspaceScope } from "./use-workspace-scope";

/** The roster's lists and the state that shapes them. */
export interface SessionLists {
	/** The ids of the pinned sessions. */
	pinned: ReadonlySet<string>;
	/** Pin the session, or unpin it when it is pinned. */
	togglePin: (sessionId: string) => void;
	/** What the search field holds. */
	query: string;
	setQuery: (query: string) => void;
	/** The selected workspace's sessions that match `query`. */
	lists: SidebarSessions;
	/** The live and interrupted sessions of `lists` by workspace, as the roster groups them. */
	groups: WorkspaceGroup[];
	/** The views of `lists`, in the order the sidebar shows them. */
	listed: View[];
	/** Live sessions in the selected workspace that wait on your move. */
	waiting: number;
	/** The session the Sessions tab opens when no pane shows one, from the selected workspace's rows before the search; `null` for none. */
	latest: View | null;
}

/** The sidebar's session lists for the selected workspace, or every workspace, its search, and the server's pins, which `changePins` changes. */
export function useSessionLists(
	{ visible, workspace, workspaces }: Pick<WorkspaceScope, "visible" | "workspace" | "workspaces">,
	pins: string[],
	changePins: (change: PinChange) => void,
): SessionLists {
	const pinned = useMemo<ReadonlySet<string>>(() => new Set(pins), [pins]);
	const pinnedRef = useRef(pinned);
	pinnedRef.current = pinned;
	const togglePin = useCallback(
		(sessionId: string) => changePins({ op: pinnedRef.current.has(sessionId) ? "unpin" : "pin", sessionIds: [sessionId] }),
		[changePins],
	);
	const [query, setQuery] = useState("");
	const workspaceLists = useMemo(() => sidebarSessions(visible.hosts, visible.past, workspace, pinned), [visible, workspace, pinned]);
	const lists = useMemo(() => searchSessions(workspaceLists, query), [workspaceLists, query]);
	const shownWorkspaces = useMemo(() => (workspace === null ? workspaces : workspaces.filter(({ cwd }) => cwd === workspace)), [workspace, workspaces]);
	const groups = useMemo(() => workspaceGroups(lists, shownWorkspaces), [lists, shownWorkspaces]);
	const listed = useMemo(() => listedViews(lists, groups), [lists, groups]);
	const waiting = useMemo(() => waitingCount(workspaceLists), [workspaceLists]);
	const latest = useMemo(() => latestSession(workspaceLists), [workspaceLists]);
	return useMemo(() => ({ pinned, togglePin, query, setQuery, lists, groups, listed, waiting, latest }), [pinned, togglePin, query, lists, groups, listed, waiting, latest]);
}
