import { createContext, useContext } from "react";
import type { StartOf } from "../starts";
import type { Dashboard } from "../use-dashboard";

/**
 * What the sidebar, the panes, and the pages ask of the dashboard. Every function is stable across renders and the
 * starts change only when a start of their own kind does, so a pane that reads this still skips a streamed token.
 */
export interface DashboardContextValue {
	send: Dashboard["send"];
	open: Dashboard["open"];
	focus: Dashboard["focus"];
	start: Dashboard["start"];
	dismissStart: Dashboard["dismissStart"];
	openNewSession: Dashboard["openNewSession"];
	changeTodo: Dashboard["changeTodo"];
	/** End running session `instanceId`, then move its panes along. */
	end: (instanceId: string) => void;
	connected: boolean;
	/** The last start of each kind, under way or failed. */
	starts: {
		fork: StartOf<"fork"> | null;
		resume: StartOf<"resume"> | null;
		quick: StartOf<"quick"> | null;
		resumeAll: StartOf<"resume-all"> | null;
	};
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboardContext(): DashboardContextValue {
	const value = useContext(DashboardContext);
	if (!value) throw new Error("useDashboardContext must be used within the App's DashboardContext.Provider");
	return value;
}
