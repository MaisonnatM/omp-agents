/** What the browser keeps of the Pull requests page: its folds, its order, the repositories you hid, its filter and display, and where a pull request's details show. */
import { parseStrings } from "../src/json";
import { type Folds, useFolds } from "./components/fold";
import { decodeDisplay, decodeFilter, encodeDisplay, encodeFilter } from "./pull-requests-filter";
import { decodeOrder, foldedByDefault } from "./pull-requests-model";
import { useStoredKeys, useStoredState } from "./stored-state";

// The folds and order keys keep their names from before the page was called Pull requests, so the browser's saved folds and order survive.
/** The repositories and sections flipped from their default fold: `owner/repo`, and `owner/repo:<section title>`. */
const FOLDS_KEY = "omp-agents.inbox-collapsed";
const ORDER_KEY = "omp-agents.inbox-order";
const HIDDEN_KEY = "omp-agents.pull-requests-hidden";
const PLACEMENT_KEY = "omp-agents.pull-request-details-placement";
const FILTER_KEY = "omp-agents.pull-requests-filter";
const DISPLAY_KEY = "omp-agents.pull-requests-display";

/** The pull request list's folds, which the list and the details page's keys share. */
export const usePullRequestsFolds = (): Folds => useFolds(FOLDS_KEY, foldedByDefault);

/** The order of the repositories, the sections, and the pull requests in a section. */
export const usePullRequestsOrder = () => useStoredState(ORDER_KEY, decodeOrder, JSON.stringify);

/** The repositories you hid from the Pull requests page and its tab's count, by `repoKey`, kept apart from their order. */
export const useHiddenRepos = () => useStoredKeys(HIDDEN_KEY);

/** The hidden repositories as they are stored now, which the list's reads skip on the server. */
export const hiddenRepoKeys = (): string[] => parseStrings(localStorage.getItem(HIDDEN_KEY));

/** What the list keeps: a tab's sections, or what you picked under **Filter**. */
export const usePullRequestsFilter = () => useStoredState(FILTER_KEY, decodeFilter, encodeFilter);

/** How the list groups its pull requests, and whether it shows its empty sections. */
export const usePullRequestsDisplay = () => useStoredState(DISPLAY_KEY, decodeDisplay, encodeDisplay);

/** Where the Pull requests page shows a pull request's details: docked beside the list, or on a page of their own. */
export type PullRequestDetailsPlacement = "beside" | "page";

const decodePlacement = (raw: string | null): PullRequestDetailsPlacement => (raw === "page" ? "page" : "beside");

export const usePullRequestDetailsPlacement = () => useStoredState(PLACEMENT_KEY, decodePlacement);
