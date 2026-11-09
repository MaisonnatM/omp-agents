/**
 * What the dashboard keeps about Google accounts in `google-accounts.json`, beside the access token: `addresses`, the
 * address each account signs in as by its server's name in omp's MCP config, `personal`, the addresses placed in the
 * Personal space, and `signedOut`, when a session first found each account signed out. Older files lack the last two,
 * and the `links` to workspaces a version before spaces kept are dropped, so every account of such a file is in Work.
 * The starter kit's `extensions/google-accounts.ts` reads it to tell sessions which account to use.
 */
import { ReducerFile } from "../fs";
import { applyGoogleAccounts, type GoogleAccountsChange, type GoogleAccountsState, type GoogleAccountsStore } from "../google-accounts";
import { isNumber, isObject, isString, isTexts, recordOf } from "../json";

function parseAccounts(value: unknown): GoogleAccountsState | null {
	if (!isObject(value) || !recordOf(isString)(value.addresses)) return null;
	const { personal = [], signedOut = {} } = value;
	if (!isTexts(personal) || !recordOf(isNumber)(signedOut)) return null;
	return { addresses: new Map(Object.entries(value.addresses)), personal: new Set(personal), signedOut: new Map(Object.entries(signedOut)) };
}

/** `google-accounts.json`, kept as a {@link GoogleAccountsState}. */
export class GoogleAccountsFile extends ReducerFile<GoogleAccountsState, [change: GoogleAccountsChange]> implements GoogleAccountsStore {
	constructor(path: string) {
		super(path, {
			parse: parseAccounts,
			toJson: ({ addresses, personal, signedOut }) => ({ addresses: Object.fromEntries(addresses), personal: [...personal], signedOut: Object.fromEntries(signedOut) }),
			holds: "Google accounts' addresses, spaces, and sign-out reports",
			empty: { addresses: new Map(), personal: new Set(), signedOut: new Map() },
			reduce: applyGoogleAccounts,
		});
	}
}
