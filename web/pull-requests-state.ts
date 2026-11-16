/** What the browser keeps of the Pull requests page: its folds, its order, the repositories you hid, the sections it shows, and where a pull request's details show. */
import { type Folds, useFolds } from "./components/fold";
import { decodeOrder, decodeShownSections, encodeShownSections, foldedByDefault } from "./pull-requests-model";
import { useStoredKeys, useStoredState } from "./stored-state";

// The folds and order keys keep their names from before the page was called Pull requests, so the browser's saved folds and order survive.
/** The repositories and sections flipped from their default fold: `owner/repo`, and `owner/repo:<section title>`. */
const FOLDS_KEY = "omp-agents.inbox-collapsed";
const ORDER_KEY = "omp-agents.inbox-order";
const HIDDEN_KEY = "omp-agents.pull-requests-hidden";
const PLACEMENT_KEY = "omp-agents.pull-request-details-placement";
const SECTIONS_KEY = "omp-agents.pull-requests-sections";

/** The pull request list's folds, which the list and the details page's keys share. */
export const usePullRequestsFolds = (): Folds => useFolds(FOLDS_KEY, foldedByDefault);

/** The order of the repositories, the sections, and the pull requests in a section. */
export const usePullRequestsOrder = () => useStoredState(ORDER_KEY, decodeOrder, JSON.stringify);

/** The repositories you hid from the Pull requests page and its tab's count, by `repoKey`, kept apart from their order. */
export const useHiddenRepos = () => useStoredKeys(HIDDEN_KEY);

/** The sections the list shows: a tab's preset, or the ones you picked under Filter. */
export const useShownSections = () => useStoredState(SECTIONS_KEY, decodeShownSections, encodeShownSections);

/** Where the Pull requests page shows a pull request's details: docked beside the list, or on a page of their own. */
export type PullRequestDetailsPlacement = "beside" | "page";

const decodePlacement = (raw: string | null): PullRequestDetailsPlacement => (raw === "page" ? "page" : "beside");

export const usePullRequestDetailsPlacement = () => useStoredState(PLACEMENT_KEY, decodePlacement);
