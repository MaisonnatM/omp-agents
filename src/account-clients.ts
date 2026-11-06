import type { AccountId } from "./shared/accounts";

/** One client of each signed-in account of a service. Gmail and Google Calendar take this. The account store builds it, so the clients do not import the store. */
export interface AccountClients<C> {
	/** Each account omp holds a sign-in to, in the order of omp's config, with its client. */
	signedIn(): Promise<{ account: AccountId; client: C }[]>;
	/** Account `account`'s client; throws when the service has no such account. */
	get(account: AccountId): Promise<C>;
}
