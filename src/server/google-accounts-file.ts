/**
 * What the dashboard keeps about Google accounts in `google-accounts.json`, beside the access token: `addresses`, the
 * address each account signs in as by its server's name in omp's MCP config, and `signedOut`, when a session first found
 * each account signed out. The starter kit's `extensions/google-accounts.ts` reads it to list which server signs in as
 * which address.
 */
import { ReducerFile } from "../fs";
import { applyGoogleAccounts, type GoogleAccountsChange, type GoogleAccountsState, type GoogleAccountsStore } from "../google-accounts";
import { isNumber, isObject, isString, recordOf } from "../json";

/** The state `value` holds. Older files lack `signedOut`, and an older version's `personal` and `links` drop. */
function parseGoogleAccounts(value: unknown): GoogleAccountsState | null {
	if (!isObject(value) || !recordOf(isString)(value.addresses)) return null;
	const { signedOut = {} } = value;
	if (!recordOf(isNumber)(signedOut)) return null;
	return { addresses: new Map(Object.entries(value.addresses)), signedOut: new Map(Object.entries(signedOut)) };
}

/** `google-accounts.json`, kept as a {@link GoogleAccountsState}. */
export class GoogleAccountsFile extends ReducerFile<GoogleAccountsState, [change: GoogleAccountsChange]> implements GoogleAccountsStore {
	constructor(path: string) {
		super(path, {
			parse: parseGoogleAccounts,
			toJson: ({ addresses, signedOut }) => ({ addresses: Object.fromEntries(addresses), signedOut: Object.fromEntries(signedOut) }),
			holds: "Google accounts' addresses and sign-out reports",
			empty: { addresses: new Map(), signedOut: new Map() },
			reduce: applyGoogleAccounts,
		});
	}
}
