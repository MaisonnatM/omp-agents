import { createContext, useContext } from "react";
import type { MentionLists } from "../mentions";
import type { StartOf } from "../starts";
import type { Dashboard } from "../use-dashboard";

/**
 * What the sidebar, the panes, and the pages ask of the dashboard. Every function is stable for the page's lifetime, so
 * a component that reads only these, such as a session row, renders for none of the dashboard's changes.
 */
export interface DashboardActions {
	send: Dashboard["send"];
	request: Dashboard["request"];
	open: Dashboard["open"];
	focus: Dashboard["focus"];
	start: Dashboard["start"];
	dismissStart: Dashboard["dismissStart"];
	openNewSession: Dashboard["openNewSession"];
	changeTodo: Dashboard["changeTodo"];
	/** End running session `instanceId`, then move its panes along once the server ended it; a failure shows as a toast. */
	end: (instanceId: string) => void;
	/** Open the text file at an absolute or `~/` path in the file dialog. */
	openFile: (path: string) => void;
	/** Open the new-ticket dialog with `title` as the issue's title. */
	openNewTicket: (title: string) => void;
}

export const DashboardActionsContext = createContext<DashboardActions | null>(null);

export function useDashboardActions(): DashboardActions {
	const value = useContext(DashboardActionsContext);
	if (!value) throw new Error("useDashboardActions must be used within the App's DashboardActionsContext.Provider");
	return value;
}

/** What changes while the page runs: the socket's state, the sessions it is starting or ending, and the inbox entry it polls. */
export interface DashboardStatus {
	connected: boolean;
	/** The last start of each kind, under way or failed. */
	starts: {
		fork: StartOf<"fork"> | null;
		resume: StartOf<"resume"> | null;
		quick: StartOf<"quick"> | null;
		resumeAll: StartOf<"resume-all"> | null;
	};
	/** The live sessions the page asked the server to end, by instance id, until it answers. */
	ending: ReadonlySet<string>;
	/**
	 * The project `cwd` whose inbox entry `App` polls, `null` for all projects. A component that wants the pull requests
	 * reads that entry, never another scope's: the all-projects entry asks GitHub about every repository.
	 */
	pullRequestScope: string | null;
}

export const DashboardStatusContext = createContext<DashboardStatus | null>(null);

export function useDashboardStatus(): DashboardStatus {
	const value = useContext(DashboardStatusContext);
	if (!value) throw new Error("useDashboardStatus must be used within the App's DashboardStatusContext.Provider");
	return value;
}

/**
 * The page's lists that the composer's `@` menu offers, provided once by `App` apart from {@link DashboardActions}, so a
 * roster or todo change renders only the composers again and not every reader of the dashboard's actions.
 */
export const MentionListsContext = createContext<MentionLists | null>(null);

export function useMentionLists(): MentionLists {
	const value = useContext(MentionListsContext);
	if (!value) throw new Error("useMentionLists must be used within the App's MentionListsContext.Provider");
	return value;
}
