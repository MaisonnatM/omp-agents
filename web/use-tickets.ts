import type { TicketsAnswer } from "../src/shared";
import { createPolledStore } from "./polled-store";

/** Linear is not per project, so the store holds one read, under `""`. */
const store = createPolledStore<TicketsAnswer>({
	cacheKey: "omp-agents.tickets-cache",
	url: (_, fresh) => `/api/tickets${fresh ? "?fresh" : ""}`,
	isValid: (value): value is TicketsAnswer => Array.isArray((value as Partial<TicketsAnswer> | null)?.tickets),
});

/** Reads the tickets again; `fresh` makes the server skip its own cache too. */
export const refreshTickets = (fresh: boolean): Promise<void> => store.refresh("", fresh);

/** The tickets from the store that the sidebar and the tickets page share; `poll` keeps them current while the caller is mounted. */
export const useTickets = (poll: boolean) => store.use("", poll);
