/**
 * What the dashboard keeps about Google accounts in `google-accounts.json`, beside the access token: `addresses`, the
 * address each account signs in as by its server's name in omp's MCP config, and `links`, the workspace directories each
 * address is linked to. The starter kit's `extensions/google-accounts.ts` reads it to tell sessions which account to use.
 */
import { ReducerFile } from "../fs";
import type { GoogleAccountsChange, GoogleAccountsState, GoogleAccountsStore } from "../integrations";
import { isObject, isTexts } from "../json";

const isStrings = (value: unknown): value is Record<string, string> => isObject(value) && Object.values(value).every(item => typeof item === "string");
const isLists = (value: unknown): value is Record<string, string[]> => isObject(value) && Object.values(value).every(isTexts);

function parseAccounts(value: unknown): GoogleAccountsState | null {
	if (!isObject(value) || !isStrings(value.addresses) || !isLists(value.links)) return null;
	return { addresses: new Map(Object.entries(value.addresses)), links: new Map(Object.entries(value.links)) };
}

/** `state` after `change`, or `state` itself when it changes nothing. */
export function applyGoogleAccounts(state: GoogleAccountsState, change: GoogleAccountsChange): GoogleAccountsState {
	switch (change.kind) {
		case "learn": {
			if (state.addresses.get(change.account) === change.address) return state;
			return { ...state, addresses: new Map(state.addresses).set(change.account, change.address) };
		}
		case "forget": {
			const gone = change.accounts.filter(account => state.addresses.has(account));
			if (gone.length === 0) return state;
			const addresses = new Map(state.addresses);
			for (const account of gone) addresses.delete(account);
			return { ...state, addresses };
		}
		case "link": {
			const workspaces = [...new Set(change.workspaces)];
			const current = state.links.get(change.address) ?? [];
			if (current.length === workspaces.length && current.every(workspace => workspaces.includes(workspace))) return state;
			const links = new Map(state.links);
			if (workspaces.length === 0) links.delete(change.address);
			else links.set(change.address, workspaces);
			return { ...state, links };
		}
		default: {
			const never: never = change;
			return never;
		}
	}
}

/** `google-accounts.json`, kept as a {@link GoogleAccountsState}. */
export class GoogleAccountsFile extends ReducerFile<GoogleAccountsState, [change: GoogleAccountsChange]> implements GoogleAccountsStore {
	constructor(path: string) {
		super(path, {
			parse: parseAccounts,
			toJson: ({ addresses, links }) => ({ addresses: Object.fromEntries(addresses), links: Object.fromEntries(links) }),
			holds: "Google accounts' addresses and workspace links",
			empty: { addresses: new Map(), links: new Map() },
			reduce: applyGoogleAccounts,
		});
	}
}
