import type { Inbox } from "../src/shared";
import { createPolledStore } from "./polled-store";

const store = createPolledStore<Inbox>({
	cacheKey: "omp-agents.inbox-cache",
	url: (cwd, fresh) => {
		const params = new URLSearchParams();
		if (cwd) params.set("cwd", cwd);
		if (fresh) params.set("fresh", "");
		return `/api/inbox${params.size ? `?${params}` : ""}`;
	},
	isValid: (value): value is Inbox => {
		const inbox = value as Partial<Inbox> | null;
		return Array.isArray(inbox?.repos) && Array.isArray(inbox.unmatched);
	},
});

/** Reads the inbox of project `scope` (`null` for every project) again; `fresh` makes the server skip its own cache too. */
export const refreshInbox = (scope: string | null, fresh: boolean): Promise<void> => store.refresh(scope ?? "", fresh);

/** `scope`'s inbox from the store that the sidebar and the inbox page share; `poll` keeps it current while the caller is mounted. */
export const useInbox = (scope: string | null, poll: boolean) => store.use(scope ?? "", poll);
