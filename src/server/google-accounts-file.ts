/**
 * What the dashboard keeps about Google accounts in `google-accounts.json`, beside the access token: `addresses`, the
 * address each account signs in as by its server's name in omp's MCP config, `personal`, the addresses placed in the
 * Personal space, and `signedOut`, when a session first found each account signed out. The personal extension reads it
 * to tell a session which account its space uses, and the starter kit's `extensions/google-accounts.ts` to list which
 * server signs in as which address.
 */
import { ReducerFile } from "../fs";
import { applyGoogleAccounts, type GoogleAccountsChange, type GoogleAccountsState, type GoogleAccountsStore } from "../google-accounts";
import { parseGoogleAccounts } from "../google-accounts-read";

/** `google-accounts.json`, kept as a {@link GoogleAccountsState}. */
export class GoogleAccountsFile extends ReducerFile<GoogleAccountsState, [change: GoogleAccountsChange]> implements GoogleAccountsStore {
	constructor(path: string) {
		super(path, {
			parse: parseGoogleAccounts,
			toJson: ({ addresses, personal, signedOut }) => ({ addresses: Object.fromEntries(addresses), personal: [...personal], signedOut: Object.fromEntries(signedOut) }),
			holds: "Google accounts' addresses, spaces, and sign-out reports",
			empty: { addresses: new Map(), personal: new Set(), signedOut: new Map() },
			reduce: applyGoogleAccounts,
		});
	}
}
