/** The Todo page's stored choices: what **Filter** keeps and how **Display** groups the list. */
import { useStoredState } from "./stored-state";
import { decodeDisplay, decodeFilter, encodeDisplay, encodeFilter } from "./todo-filter";

/** What the list keeps, of what you picked under **Filter**. */
export const useTodoFilter = () => useStoredState("omp-agents.todo-filter", decodeFilter, encodeFilter);

/** How the list groups its todos. */
export const useTodoDisplay = () => useStoredState("omp-agents.todo-display", decodeDisplay, encodeDisplay);
