/**
 * What the dashboard keeps about Google accounts in `google-accounts.json`, beside the access token: `addresses`, the
 * address each account signs in as by its server's name in omp's MCP config, `links`, the workspace directories each
 * address is linked to, and `signedOut`, when a session first found each account signed out, which older files lack.
 * The starter kit's `extensions/google-accounts.ts` reads it to tell sessions which account to use.
 */
import { ReducerFile } from "../fs";
import { applyGoogleAccounts, type GoogleAccountsChange, type GoogleAccountsState, type GoogleAccountsStore } from "../google-accounts";
import { isNumber, isObject, isString, isTexts, recordOf } from "../json";

function parseAccounts(value: unknown): GoogleAccountsState | null {
	if (!isObject(value) || !recordOf(isString)(value.addresses) || !recordOf(isTexts)(value.links)) return null;
	const signedOut = value.signedOut ?? {};
	if (!recordOf(isNumber)(signedOut)) return null;
	return { addresses: new Map(Object.entries(value.addresses)), links: new Map(Object.entries(value.links)), signedOut: new Map(Object.entries(signedOut)) };
}

/** `google-accounts.json`, kept as a {@link GoogleAccountsState}. */
export class GoogleAccountsFile extends ReducerFile<GoogleAccountsState, [change: GoogleAccountsChange]> implements GoogleAccountsStore {
	constructor(path: string) {
		super(path, {
			parse: parseAccounts,
			toJson: ({ addresses, links, signedOut }) => ({ addresses: Object.fromEntries(addresses), links: Object.fromEntries(links), signedOut: Object.fromEntries(signedOut) }),
			holds: "Google accounts' addresses, workspace links, and sign-out reports",
			empty: { addresses: new Map(), links: new Map(), signedOut: new Map() },
			reduce: applyGoogleAccounts,
		});
	}
}
