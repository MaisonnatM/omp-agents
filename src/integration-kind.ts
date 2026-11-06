import type { AccountId, GoogleAccount, McpConnection } from "./shared/accounts";
import type { SignIn } from "./sign-in";

/**
 * What Settings › Integrations does with one service: its one server's connection, or each of its accounts. A sign-in
 * and a removal name an account, `null` to add one or for a service of one server. The account store returns one, and
 * the integrations module takes that store, so neither imports the other for this.
 */
export interface IntegrationKind<Connections extends { connection: McpConnection } | { accounts: GoogleAccount[] }> {
	/** Where omp stands with the service; what `signIn` targets keeps its status while the sign-in waits on the browser. */
	load(fresh: boolean, signIn: SignIn<AccountId | null>): Promise<Connections>;
	signIn(account: AccountId | null, signal: AbortSignal, waiting: (url: string) => void): Promise<void>;
	remove(account: AccountId | null): Promise<void>;
	/** Drops the sign-ins made with an OAuth client that changed. */
	dropSignIns(): Promise<void>;
}
