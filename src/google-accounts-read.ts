/** Reading `google-accounts.json`: the server's `GoogleAccountsFile` keeps it, and the personal extension reads it each turn. */
import { readFileSync } from "node:fs";
import type { GoogleAccountsState } from "./google-accounts";
import { isNumber, isObject, isString, isTexts, recordOf } from "./json";

/**
 * The state `value` holds. Older files lack `personal` and `signedOut`, and the `links` to workspaces a version before
 * spaces kept are dropped, so every account of such a file is in Work.
 */
export function parseGoogleAccounts(value: unknown): GoogleAccountsState | null {
	if (!isObject(value) || !recordOf(isString)(value.addresses)) return null;
	const { personal = [], signedOut = {} } = value;
	if (!isTexts(personal) || !recordOf(isNumber)(signedOut)) return null;
	return { addresses: new Map(Object.entries(value.addresses)), personal: new Set(personal), signedOut: new Map(Object.entries(signedOut)) };
}

/** The state the file at `path` holds; `null` when it is missing, unreadable, or holds anything else. */
export function readGoogleAccounts(path: string): GoogleAccountsState | null {
	try {
		return parseGoogleAccounts(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return null;
	}
}
