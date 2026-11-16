/** What the browser keeps of the Tickets page's bar: its tab and filter, and its display. */
import { decodeDisplay, decodeFilter, encodeDisplay, encodeFilter } from "./tickets-filter";
import { useStoredState } from "./stored-state";

const FILTER_KEY = "omp-agents.tickets-filter";
const DISPLAY_KEY = "omp-agents.tickets-display";

/** What the list keeps: the tab, and what you picked under **Filter**. */
export const useTicketsFilter = () => useStoredState(FILTER_KEY, decodeFilter, encodeFilter);

/** How the list groups its issues. */
export const useTicketsDisplay = () => useStoredState(DISPLAY_KEY, decodeDisplay, encodeDisplay);
