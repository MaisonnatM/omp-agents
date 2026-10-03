import type { LinearStatus } from "../src/shared";
import { createPolledStore } from "./polled-store";

/** Whether omp is signed in to Linear, which the sidebar's tabs, the tickets page, and the settings share. */
const store = createPolledStore<LinearStatus>({
	cacheKey: "omp-agents.linear-cache",
	url: () => "/api/linear",
	isValid: (value): value is LinearStatus => typeof (value as Partial<LinearStatus> | null)?.connected === "boolean",
});

export const refreshLinear = (): Promise<void> => store.refresh("", false);

/** The store's last read of Linear's connection; `poll` keeps it current while the caller is mounted. */
export const useLinear = (poll: boolean) => store.use("", poll);
