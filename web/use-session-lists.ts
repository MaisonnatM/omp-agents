import { useMemo, useState } from "react";
import { listedViews, searchSessions, type SidebarSessions, sidebarSessions, waitingCount } from "./sessions";
import { PINNED_SESSIONS_KEY, useStoredKeys } from "./stored-state";
import type { View } from "../src/shared/sessions";
import type { Workspace } from "./use-workspace";

/** The Sessions tab's lists and the state that shapes them. */
export interface SessionLists {
	/** The ids of the pinned sessions. */
	pinned: ReadonlySet<string>;
	/** Pin the session, or unpin it when it is pinned. */
	togglePin: (sessionId: string) => void;
	/** What the search field holds. */
	query: string;
	setQuery: (query: string) => void;
	/** The selected project's sessions that match `query`. */
	lists: SidebarSessions;
	/** The views of `lists`, in the order the sidebar shows them. */
	listed: View[];
	/** Live sessions in the selected project that wait on your move. */
	waiting: number;
}

/** The sidebar's session lists for the selected project, its search, and its pins. */
export function useSessionLists({ visible, project }: Pick<Workspace, "visible" | "project">): SessionLists {
	const [pinned, togglePin] = useStoredKeys(PINNED_SESSIONS_KEY);
	const [query, setQuery] = useState("");
	const projectLists = useMemo(() => sidebarSessions(visible.hosts, visible.past, project, pinned), [visible, project, pinned]);
	const lists = useMemo(() => searchSessions(projectLists, query), [projectLists, query]);
	const listed = useMemo(() => listedViews(lists), [lists]);
	const waiting = useMemo(() => waitingCount(projectLists), [projectLists]);
	return useMemo(() => ({ pinned, togglePin, query, setQuery, lists, listed, waiting }), [pinned, togglePin, query, lists, listed, waiting]);
}
