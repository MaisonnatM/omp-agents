import { useStoredKeys } from "./stored-state";

const HIDDEN_KEY = "omp-agents.todo-hidden-categories";

/** The ids of the todo categories you unchecked in the sidebar, whose todos stay out of All, Today, Needs you, and From agents, with a toggle that flips each id it names. */
export const useHiddenTodoCategories = (): [ReadonlySet<string>, (...ids: string[]) => void] => useStoredKeys(HIDDEN_KEY);
