/** The merge method a pull request's merge button starts with, and the one the last confirmed merge used, both kept in this browser. */
import { MERGE_METHODS, type MergeMethod, type MergeMethodChoice } from "../src/shared/source-control";
import { useStoredState } from "./stored-state";

const CHOICE_KEY = "omp-agents.merge-method";
const LAST_KEY = "omp-agents.last-merge-method";

const asMethod = (raw: string | null): MergeMethod | null => MERGE_METHODS.find(method => method === raw) ?? null;

/** Settings' **Default merge method**: `last` until you pick another. */
export const useMergeMethodChoice = (): [MergeMethodChoice, (choice: MergeMethodChoice) => void] => useStoredState<MergeMethodChoice>(CHOICE_KEY, raw => asMethod(raw) ?? "last");

/** The method the last confirmed merge used, `null` before the first merge. */
export const useLastMergeMethod = (): [MergeMethod | null, (method: MergeMethod | null) => void] => useStoredState<MergeMethod | null>(LAST_KEY, asMethod, method => method ?? "");
