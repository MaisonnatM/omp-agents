/** The Notifications page's stored choices: its tab and what **Filter** keeps, and how **Display** groups the list. */
import { decodeDisplay, decodeFilter, encodeDisplay, encodeFilter } from "./notice-filter";
import { useStoredState } from "./stored-state";

/** The tab, and what the list keeps of what you picked under **Filter**. */
export const useNoticesFilter = () => useStoredState("omp-agents.notifications-filter", decodeFilter, encodeFilter);

/** How the list groups its notices. */
export const useNoticesDisplay = () => useStoredState("omp-agents.notifications-display", decodeDisplay, encodeDisplay);
