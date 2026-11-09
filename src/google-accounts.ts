/**
 * Gmail's and Google Calendar's accounts: a server per account on the service's host in omp's MCP config. Google's
 * endpoints answer only their bare URL, so omp would file every account's sign-in under that URL; each sign-in here
 * lands on a credential id of its own instead, which the account's server names in its `auth` block. The address each
 * account signs in as, and the space each address is in, live in a {@link GoogleAccountsStore}.
 */
import { randomBytes } from "node:crypto";
import type { AccountClients } from "./account-clients";
import { gmailAddress } from "./gmail";
import { calendarAddress } from "./google-calendar";
import type { IntegrationKind } from "./integration-kind";
import { errorText } from "./json";
import { planGoogleScope } from "./mcp-clients";
import { remoteStatusOf } from "./mcp-status";
import {
	addMcpServer,
	findMcpServers,
	listMcpServers,
	mcpBearer,
	type McpServer,
	type McpServerConfig,
	mcpSignedIn,
	mcpSignedInIds,
	removeMcpServer,
	signInMcp,
	signOutMcp,
	userMcpConfigPath,
	writeMcpServer,
} from "./omp/mcp";
import { type AccountId, type AccountsService, type GoogleAccount, type GoogleSpace, MCP_SERVICES, serverConnection } from "./shared/accounts";
import type { SignInSubject } from "./shared/notices";
import { type SignedFetch, signedFetch } from "./signed-fetch";

/**
 * What the dashboard keeps about Google accounts: each account's address, lowercased, by its server's name, the
 * lowercased addresses placed in the Personal space, and since when each account a session found signed out has been
 * reported so, by its server's name, until it works again or the user signs it out. An address not placed is in Work.
 */
export interface GoogleAccountsState {
	addresses: ReadonlyMap<AccountId, string>;
	personal: ReadonlySet<string>;
	signedOut: ReadonlyMap<AccountId, number>;
}

/**
 * A change to {@link GoogleAccountsState}: an account's address learned, accounts whose servers are gone, an address
 * placed in a space, an account a session found signed out at `at`, or an account whose report is settled because it
 * signed in again or the user signed it out.
 */
export type GoogleAccountsChange =
	| { kind: "learn"; account: AccountId; address: string }
	| { kind: "forget"; accounts: readonly AccountId[] }
	| ({ kind: "place" } & GoogleSpace)
	| { kind: "signed-out"; account: AccountId; at: number }
	| { kind: "settle"; account: AccountId };

/** Where {@link GoogleAccountsState} is kept: `google-accounts.json`, through `src/server/google-accounts-file.ts`. */
export interface GoogleAccountsStore {
	readonly value: GoogleAccountsState;
	apply(change: GoogleAccountsChange): boolean;
}

/**
 * `state` after `change`, or `state` itself when it changes nothing. Forgetting an account keeps its address's space,
 * so an account added again as the same address is in the space it was. A second report of an account already reported
 * signed out keeps the first one's time, so the bell does not tell of it again.
 */
export function applyGoogleAccounts(state: GoogleAccountsState, change: GoogleAccountsChange): GoogleAccountsState {
	switch (change.kind) {
		case "learn": {
			if (state.addresses.get(change.account) === change.address) return state;
			return { ...state, addresses: new Map(state.addresses).set(change.account, change.address) };
		}
		case "forget": {
			const gone = change.accounts.filter(account => state.addresses.has(account) || state.signedOut.has(account));
			if (gone.length === 0) return state;
			const addresses = new Map(state.addresses);
			const signedOut = new Map(state.signedOut);
			for (const account of gone) {
				addresses.delete(account);
				signedOut.delete(account);
			}
			return { ...state, addresses, signedOut };
		}
		case "place": {
			if (state.personal.has(change.address) === (change.space === "personal")) return state;
			const personal = new Set(state.personal);
			if (change.space === "personal") personal.add(change.address);
			else personal.delete(change.address);
			return { ...state, personal };
		}
		case "signed-out": {
			if (state.signedOut.has(change.account)) return state;
			return { ...state, signedOut: new Map(state.signedOut).set(change.account, change.at) };
		}
		case "settle": {
			if (!state.signedOut.has(change.account)) return state;
			const signedOut = new Map(state.signedOut);
			signedOut.delete(change.account);
			return { ...state, signedOut };
		}
		default: {
			const never: never = change;
			return never;
		}
	}
}

/** What Google asks while the page adds an account: which account, then the grant, so a second account can be picked. */
const ADD_PROMPT = "select_account consent";

/** omp's `omp token` and `removeManagedMcpOAuthCredentials` manage an id with omp's `mcp_oauth_` prefix; the rest names the dashboard's. */
const ACCOUNT_ID_PREFIX = "mcp_oauth_omp_agents_";

/** How each service learns which address an account signs in as. */
const ADDRESS_OF: Record<AccountsService, (fetch: SignedFetch) => Promise<string>> = { gmail: gmailAddress, "google-calendar": calendarAddress };

/** The services that hold an account per server. */
const ACCOUNTS_SERVICES = Object.keys(ADDRESS_OF) as AccountsService[];

const serversOf = (id: AccountsService): Promise<McpServer[]> => findMcpServers(MCP_SERVICES[id].host);

/** Server `account` of service `id`. */
async function accountServer(id: AccountsService, account: AccountId): Promise<McpServer> {
	const server = (await serversOf(id)).find(candidate => candidate.name === account);
	if (!server) throw new Error(`${MCP_SERVICES[id].label} has no account "${account}". Add it in Settings › Integrations.`);
	return server;
}

/** Calls Google's APIs with omp's sign-in to `server`. */
const serverFetch = (server: McpServer): SignedFetch => signedFetch(async () => mcpBearer(server));

/**
 * A client per account of `id`, made by `make` on first use with the account's sign-in. Every sign-in lands on a new
 * credential id, so a client is made again once its server names another one, and never calls Google as an account
 * signed in before. A client is dropped once its server is gone.
 */
export function accountClients<C>(id: AccountsService, make: (fetch: SignedFetch, account: AccountId) => C): AccountClients<C> {
	const made = new Map<AccountId, { credentialId: string; client: C }>();
	const clientOf = (server: McpServer): C => {
		const kept = made.get(server.name);
		if (kept?.credentialId === server.credentialId) return kept.client;
		const client = make(serverFetch(server), server.name);
		made.set(server.name, { credentialId: server.credentialId, client });
		return client;
	};
	return {
		async signedIn() {
			const servers = await serversOf(id);
			const held = await mcpSignedInIds(servers.map(server => server.credentialId));
			for (const name of made.keys()) if (!servers.some(server => server.name === name)) made.delete(name);
			return servers.filter(server => held.has(server.credentialId)).map(server => ({ account: server.name, client: clientOf(server) }));
		},
		get: async account => clientOf(await accountServer(id, account)),
	};
}

/** The first `<base>-<n>` from 2 up that names no server omp loads; omp refuses a second server of one name. */
async function freeName(base: string): Promise<string> {
	const taken = new Set((await listMcpServers()).map(server => server.name));
	for (let n = 2; ; n++) {
		const name = `${base}-${n}`;
		if (!taken.has(name)) return name;
	}
}

/** An account a session reported signed out, as the bell tells of it, `since` it was first reported. */
export type SignedOutAccount = Omit<SignInSubject, "kind"> & { since: number };

/** The accounts of Gmail and Google Calendar. */
export interface GoogleAccounts {
	/** Service `id`'s accounts, as Settings › Integrations lists, signs in to, adds, and removes them. */
	of(id: AccountsService): IntegrationKind<{ accounts: GoogleAccount[] }>;
	/** Forgets the addresses and reports of the accounts not in `live`, whose servers are gone. */
	forgetGone(live: ReadonlySet<AccountId>): void;
	/** Places Google address `address`'s accounts, Gmail's and Google Calendar's, in `space`. */
	place(placed: GoogleSpace): void;
	/** Keeps that a session found account `account` signed out at `at`; whether it is a Gmail or Google Calendar account whose report is new. */
	reportSignedOut(account: AccountId, at: number): Promise<boolean>;
	/**
	 * The reported accounts that still do not work. A report settles once its account works again, as a sign-in through omp
	 * rather than Settings makes it, or once its server is gone.
	 */
	signedOut(): Promise<SignedOutAccount[]>;
}

/**
 * The Google accounts kept in `store`; `grant` is the browser sign-in, omp's `/mcp reauth` flow outside tests, and
 * `status` reads where omp stands with an account's server.
 */
export function createGoogleAccounts(store: GoogleAccountsStore, grant: typeof signInMcp = signInMcp, status: typeof remoteStatusOf = remoteStatusOf): GoogleAccounts {
	const addressOf = async (id: AccountsService, server: McpServer): Promise<string> => (await ADDRESS_OF[id](serverFetch(server))).toLowerCase();

	const learnAddress = async (id: AccountsService, server: McpServer): Promise<string> => {
		const address = await addressOf(id, server);
		store.apply({ kind: "learn", account: server.name, address });
		return address;
	};

	/** Keeps the address `server`'s sign-in reads as, unless Google does not say or another account of `id` already signs in as it. */
	const claimAddress = async (id: AccountsService, server: McpServer): Promise<void> => {
		const others = (await serversOf(id)).filter(other => other.name !== server.name);
		const known = await Promise.all(others.map(other => store.value.addresses.get(other.name) ?? learnAddress(id, other).catch(() => null)));
		const address = await addressOf(id, server);
		if (known.includes(address)) throw new Error(`${address} is already connected to ${MCP_SERVICES[id].label}.`);
		store.apply({ kind: "learn", account: server.name, address });
	};

	/** The account `server` holds, with its address read from Google once omp holds its sign-in and the store does not know it. */
	const accountOf = async (id: AccountsService, server: McpServer, signedIn: boolean, status: GoogleAccount["connection"]): Promise<GoogleAccount> => {
		const known = store.value.addresses.get(server.name) ?? null;
		const { address, addressError } =
			known !== null || !signedIn
				? { address: known, addressError: null }
				: await learnAddress(id, server).then(
						address => ({ address, addressError: null }),
						(err: unknown) => ({ address: null, addressError: errorText(err) }),
					);
		return { name: server.name, address, addressError, connection: status, space: address !== null && store.value.personal.has(address) ? "personal" : "work" };
	};

	/*
	 * The grant lands on a new credential id, and the server is written to name it only once its address is claimed:
	 * omp answers a server whose own sign-in is missing with the one filed under its URL, another account's. A refused
	 * or failed sign-in removes the new grant and leaves the server and its address as they were; a kept one removes
	 * the server's old grant. The only server on the host while it holds no sign-in takes an added account.
	 */
	const signInAccount = async (id: AccountsService, account: AccountId | null, signal: AbortSignal, waiting: (url: string) => void): Promise<void> => {
		const service = MCP_SERVICES[id];
		for (const { name, server } of await planGoogleScope(userMcpConfigPath(), id)) await writeMcpServer(userMcpConfigPath(), name, server);
		const servers = await serversOf(id);
		const [first] = servers;
		if (!first) throw new Error(`${service.label} has no server to sign in to.`);
		const existing = account !== null ? await accountServer(id, account) : servers.length === 1 && !(await mcpSignedIn(first)) ? first : null;
		const name = existing?.name ?? (await freeName(service.serverName));
		const credentialId = `${ACCOUNT_ID_PREFIX}${randomBytes(8).toString("hex")}`;
		const config: McpServerConfig = { ...(existing?.config ?? { type: "http", url: service.url, oauth: first.config.oauth }), auth: { type: "oauth", credentialId } };
		const signed: McpServer = { name, url: existing?.url ?? service.url, credentialId, config };
		await grant(
			{ url: signed.url, credentialId, oauth: config.oauth },
			{ onAuth: waiting, signal, requireRefresh: service.requireRefresh, prompt: account === null ? ADD_PROMPT : undefined },
		);
		const before = store.value.addresses.get(name);
		try {
			await claimAddress(id, signed);
			if (existing) await writeMcpServer(userMcpConfigPath(), name, config);
			else await addMcpServer(name, config);
		} catch (err) {
			store.apply(before === undefined ? { kind: "forget", accounts: [name] } : { kind: "learn", account: name, address: before });
			await signOutMcp(signed);
			throw err;
		}
		if (existing) await signOutMcp(existing);
		store.apply({ kind: "settle", account: name });
	};

	/** The service and server of account `account`, `null` while no Gmail or Google Calendar server has its name. */
	const findAccount = async (account: AccountId): Promise<{ id: AccountsService; server: McpServer } | null> => {
		for (const id of ACCOUNTS_SERVICES) {
			const server = (await serversOf(id)).find(candidate => candidate.name === account);
			if (server) return { id, server };
		}
		return null;
	};

	/** Removes `server` and its sign-in, the server first, so omp never loads it without its sign-in and falls back to the one filed under the URL. */
	const removeAccountServer = async (server: McpServer): Promise<void> => {
		await removeMcpServer(server.name);
		store.apply({ kind: "forget", accounts: [server.name] });
		await signOutMcp(server);
	};

	return {
		of: id => ({
			async load(fresh, signIn) {
				const servers = await serversOf(id);
				const held = await mcpSignedInIds(servers.map(server => server.credentialId));
				const accounts = servers.map(async server => {
					const signedIn = held.has(server.credentialId);
					const remote = await signIn.hold(server.name, () => status(server, { signedIn, signInRequired: true }, fresh));
					return accountOf(id, server, signedIn, serverConnection(server, remote));
				});
				return { accounts: await Promise.all(accounts) };
			},

			signIn: (account, signal, waiting) => signInAccount(id, account, signal, waiting),

			/** The last account on the host keeps its server, which holds the OAuth client, and is signed out, which settles its report. */
			async remove(account) {
				if (account === null) throw new Error(`Name the ${MCP_SERVICES[id].label} account to remove.`);
				const servers = await serversOf(id);
				const server = await accountServer(id, account);
				if (servers.length > 1) await removeAccountServer(server);
				else {
					await signOutMcp(server);
					store.apply({ kind: "settle", account: server.name });
				}
			},

			/** Every account but the first goes with its sign-in, and the first, which keeps the OAuth client, is signed out. */
			async dropSignIns() {
				const [kept, ...rest] = await serversOf(id);
				for (const server of rest) await removeAccountServer(server);
				if (!kept) return;
				await signOutMcp(kept);
				store.apply({ kind: "settle", account: kept.name });
			},
		}),

		forgetGone(live) {
			const gone = [...new Set([...store.value.addresses.keys(), ...store.value.signedOut.keys()])].filter(account => !live.has(account));
			if (gone.length > 0) store.apply({ kind: "forget", accounts: gone });
		},

		place({ address, space }) {
			store.apply({ kind: "place", address: address.toLowerCase(), space });
		},

		async reportSignedOut(account, at) {
			return (await findAccount(account)) !== null && store.apply({ kind: "signed-out", account, at });
		},

		// Lists the tools afresh: a list from before the session's 401 would read as working.
		async signedOut() {
			const reported = [...store.value.signedOut].map(async ([account, since]): Promise<SignedOutAccount[]> => {
				const found = await findAccount(account);
				const remote = found && (await status(found.server, { signedIn: await mcpSignedIn(found.server), signInRequired: true }, true));
				if (!found || remote?.kind === "ready") {
					store.apply({ kind: "settle", account });
					return [];
				}
				return [{ service: found.id, account, address: store.value.addresses.get(account) ?? null, since }];
			});
			return (await Promise.all(reported)).flat();
		},
	};
}
