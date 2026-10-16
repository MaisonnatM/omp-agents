/**
 * The services whose MCP server the integrations page signs omp in to: where omp stands with each, checked by listing
 * the server's tools, and the sign-ins and removals the page starts. Linear and Slack sign in to the first server on
 * their host, and a sign-in adds it to omp's user-level MCP config when omp has none. Gmail and Google Calendar hold an
 * account per server on their host: an account the page adds gets a server of its own, with a credential id of its own,
 * once Google granted it. The address each account signs in as, and the workspaces each address is linked to, live in a
 * {@link GoogleAccountsStore}.
 */
import { randomBytes } from "node:crypto";
import { gmailAddress } from "./gmail";
import { calendarAddress } from "./google-calendar";
import { clientSetup, type ClientSave, planGoogleSave, planGoogleScope, planSlackSave } from "./mcp-clients";
import { remoteStatusOf } from "./mcp-status";
import {
	addMcpServer,
	findMcpServers,
	listMcpServers,
	mcpBearer,
	type McpServer,
	type McpServerConfig,
	type McpSignInTarget,
	mcpSignedIn,
	mcpSignedInIds,
	removeMcpServer,
	signInMcp,
	signOutMcp,
	userMcpConfigPath,
	writeMcpServer,
} from "./omp/mcp";
import {
	type AccountId,
	type AccountsService,
	type ClientService,
	type GoogleAccount,
	type GoogleClientInput,
	type GoogleLinks,
	type GoogleService,
	holdsAccounts,
	type IntegrationsAnswer,
	type IntegrationTarget,
	isGoogleService,
	MCP_INTEGRATIONS,
	MCP_SERVICES,
	type McpClient,
	type McpIntegration,
	type McpIntegrationId,
	type McpServerRef,
	type SingleService,
	type SlackClientInput,
} from "./shared/accounts";
import { createSignIn, type SignIn } from "./sign-in";
import { type SignedFetch, signedFetch } from "./signed-fetch";

/** What the dashboard keeps about Google accounts: each account's address by its server's name, and each address's linked workspaces. */
export interface GoogleAccountsState {
	addresses: ReadonlyMap<AccountId, string>;
	links: ReadonlyMap<string, readonly string[]>;
}

/** A change to {@link GoogleAccountsState}: an account's address learned, accounts whose servers are gone, or an address's links replaced. */
export type GoogleAccountsChange =
	| { kind: "learn"; account: AccountId; address: string }
	| { kind: "forget"; accounts: readonly AccountId[] }
	| { kind: "link"; address: string; workspaces: readonly string[] };

/** Where {@link GoogleAccountsState} is kept: `google-accounts.json`, through `src/server/google-accounts-file.ts`. */
export interface GoogleAccountsStore {
	readonly value: GoogleAccountsState;
	apply(change: GoogleAccountsChange): boolean;
}

const signIns = Object.fromEntries(
	MCP_INTEGRATIONS.map(id => [id, createSignIn(`${MCP_SERVICES[id].label}'s sign-in page was not completed within 5 minutes. Try again.`)]),
) as Record<McpIntegrationId, SignIn>;

/** The account each service's latest sign-in targets, `null` while it adds one; a service of one server always has `null`. */
const signInTargets = Object.fromEntries(MCP_INTEGRATIONS.map(id => [id, null])) as Record<McpIntegrationId, AccountId | null>;

/** What Google asks while the page adds an account: which account, then the grant, so a second account can be picked. */
const ADD_PROMPT = "select_account consent";

/** omp's `omp token` and `removeManagedMcpOAuthCredentials` manage an id with omp's `mcp_oauth_` prefix; the rest names the dashboard's. */
const ACCOUNT_ID_PREFIX = "mcp_oauth_omp_agents_";

/** How each service of many accounts learns which address an account signs in as. */
const ADDRESS_OF: Record<AccountsService, (fetch: SignedFetch) => Promise<string>> = { gmail: gmailAddress, "google-calendar": calendarAddress };

/**
 * The server name `name` as omp mints it into its tool names, `mcp__<this>_<tool>`.
 * Copied from omp's `sanitizeMCPToolNamePart` (src/mcp/tool-bridge.ts) and from the starter kit's
 * `extensions/google-accounts.ts`; change all three together.
 */
const toolPrefixOf = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "") || "server";

const serversOf = (id: McpIntegrationId): Promise<McpServer[]> => findMcpServers(MCP_SERVICES[id].host);

const refOf = (server: McpServer): McpServerRef => ({ name: server.name, url: server.url, host: new URL(server.url).host });

const targetOf = (server: McpServer): McpSignInTarget => ({ url: server.url, credentialId: server.credentialId, oauth: server.config.oauth });

/** omp's server for `id`, which reads and writes the service through its tools. */
export async function integrationServer(id: SingleService): Promise<McpServer> {
	const [server] = await serversOf(id);
	if (!server) throw new Error(`${MCP_SERVICES[id].label} is not connected. Connect it in Settings › Integrations.`);
	return server;
}

/** Whether omp has a server for `id` and holds a sign-in to it. */
export async function integrationSignedIn(id: SingleService): Promise<boolean> {
	const [server] = await serversOf(id);
	return !!server && (await mcpSignedIn(server));
}

/** Calls the APIs of service `id`, such as Slack's Web API, with omp's sign-in to its server. */
export const integrationFetch = (id: SingleService): SignedFetch => signedFetch(async () => mcpBearer(await integrationServer(id)));

/** Server `account` of service `id`. */
async function accountServer(id: AccountsService, account: AccountId): Promise<McpServer> {
	const server = (await serversOf(id)).find(candidate => candidate.name === account);
	if (!server) throw new Error(`${MCP_SERVICES[id].label} has no account "${account}". Add it in Settings › Integrations.`);
	return server;
}

/** Calls the APIs of service `id`, such as Google's Gmail API, with omp's sign-in to the server of `account`. */
export const accountFetch = (id: AccountsService, account: AccountId): SignedFetch => signedFetch(async () => mcpBearer(await accountServer(id, account)));

/** One client of each signed-in account of a service. */
export interface AccountClients<C> {
	/** Each account omp holds a sign-in to, in the order of omp's config, with its client. */
	signedIn(): Promise<{ account: AccountId; client: C }[]>;
	/** Account `account`'s client; throws when the service has no such account. */
	get(account: AccountId): Promise<C>;
}

/**
 * A client per account of `id`, made by `make` on first use. A client is dropped once its server is gone or names
 * another credential id, so an account removed and added again under the same name keeps nothing of the old one.
 */
export function accountClients<C>(id: AccountsService, make: (fetch: SignedFetch, account: AccountId) => C): AccountClients<C> {
	const made = new Map<AccountId, { credentialId: string; client: C }>();
	const clientOf = (server: McpServer): C => {
		const kept = made.get(server.name);
		if (kept?.credentialId === server.credentialId) return kept.client;
		const client = make(accountFetch(id, server.name), server.name);
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

/** The address `server`'s sign-in reads as, from Google, kept in `store`. */
async function learnAddress(store: GoogleAccountsStore, id: AccountsService, server: McpServer): Promise<string> {
	const address = await ADDRESS_OF[id](signedFetch(async () => mcpBearer(server)));
	store.apply({ kind: "learn", account: server.name, address });
	return address;
}

const signInOf = (id: McpIntegrationId) => {
	const state = signIns[id].state();
	return state && { ...state, account: signInTargets[id] };
};

/** `id`'s integration with its first server, which every service requires a sign-in to: its status is held while a sign-in waits on the browser. */
async function loadSingle(id: SingleService, fresh: boolean): Promise<McpIntegration> {
	const [found] = await serversOf(id);
	const connection = found
		? { ...(await signIns[id].hold(async () => remoteStatusOf(found, { signedIn: await mcpSignedIn(found), signInRequired: true }, fresh))), server: refOf(found) }
		: ({ kind: "absent" } as const);
	return { id, connection, signIn: signInOf(id), setup: await clientSetup(id) } as McpIntegration;
}

/**
 * `id`'s integration with an account per server on its host. An account omp holds a sign-in to whose address is not
 * known yet asks Google for it. The account a sign-in targets keeps its status while the sign-in waits on the browser.
 */
async function loadAccounts(store: GoogleAccountsStore, id: AccountsService, fresh: boolean): Promise<McpIntegration> {
	const servers = await serversOf(id);
	const held = await mcpSignedInIds(servers.map(server => server.credentialId));
	const accounts = await Promise.all(
		servers.map(async (server): Promise<GoogleAccount> => {
			const signedIn = held.has(server.credentialId);
			const read = () => remoteStatusOf(server, { signedIn, signInRequired: true }, fresh);
			const status = signInTargets[id] === server.name ? await signIns[id].hold(read) : await read();
			const address = store.value.addresses.get(server.name) ?? (signedIn ? await learnAddress(store, id, server).catch(() => null) : null);
			return { name: server.name, address, connection: { ...status, server: refOf(server) }, workspaces: [...((address && store.value.links.get(address)) || [])] };
		}),
	);
	return { id, accounts, signIn: signInOf(id), setup: await clientSetup(id) } as McpIntegration;
}

const loadIntegration = (store: GoogleAccountsStore, id: McpIntegrationId, fresh: boolean): Promise<McpIntegration> =>
	holdsAccounts(id) ? loadAccounts(store, id, fresh) : loadSingle(id, fresh);

/**
 * Every integration; `fresh` lists each signed-in server's tools again rather than the minute-old list. The addresses
 * kept for accounts whose server is gone are forgotten.
 */
export async function loadIntegrations(store: GoogleAccountsStore, fresh: boolean): Promise<IntegrationsAnswer> {
	const loaded = await Promise.all(MCP_INTEGRATIONS.map(id => loadIntegration(store, id, fresh)));
	const live = new Set(loaded.flatMap(integration => ("accounts" in integration ? integration.accounts.map(account => account.name) : [])));
	const gone = [...store.value.addresses.keys()].filter(account => !live.has(account));
	if (gone.length > 0) store.apply({ kind: "forget", accounts: gone });
	return { integrations: Object.fromEntries(loaded.map(integration => [integration.id, integration])) as IntegrationsAnswer["integrations"] };
}

const SETUP_ERROR: Record<Exclude<McpClient, "none">, string> = {
	"slack-app": "Set up the Slack app before connecting. Save a client ID, client secret, HTTPS redirect, callback port, and at least one supported scope.",
	"google-oauth": "Set up the Google OAuth client before connecting. Save its client ID, client secret, and callback port.",
};

/** The first `<base>-<n>` from 2 up whose tool names differ from those of every server omp loads. */
async function freeName(base: string): Promise<string> {
	const taken = new Set((await listMcpServers()).map(server => toolPrefixOf(server.name)));
	for (let n = 2; ; n++) {
		const name = `${base}-${n}`;
		if (!taken.has(toolPrefixOf(name))) return name;
	}
}

interface Waiting {
	signal: AbortSignal;
	waiting: (url: string) => void;
}

/** Signs in to the first server of `id`, else to its URL and adds its server once the browser comes back. */
async function signInSingle(id: SingleService, { signal, waiting }: Waiting): Promise<void> {
	const service = MCP_SERVICES[id];
	const [found] = await serversOf(id);
	await signInMcp(found ? targetOf(found) : { url: service.url }, { onAuth: waiting, signal, requireRefresh: service.requireRefresh });
	if (!found) await addMcpServer(service.serverName, { type: "http", url: service.url });
}

/**
 * Signs in to account `account` of `id` again under its own credential id, or adds one when `account` is `null`. The
 * only server on the host while it holds no sign-in, the one that keeps the OAuth client, takes the new account; any
 * other gets a new server with the first server's client and a credential id of its own. The grant is stored under
 * that id before the server is written, so omp never loads a server whose sign-in is missing, which it would answer
 * with the sign-in filed under the URL, another account's. An address another account already signs in as is refused,
 * and its grant removed.
 */
async function signInAccount(store: GoogleAccountsStore, id: AccountsService, account: AccountId | null, { signal, waiting }: Waiting): Promise<void> {
	const service = MCP_SERVICES[id];
	const servers = await serversOf(id);
	const options = { onAuth: waiting, signal, requireRefresh: service.requireRefresh };
	if (account !== null) {
		const server = servers.find(candidate => candidate.name === account);
		if (!server) throw new Error(`${service.label} has no account "${account}".`);
		await signInMcp(targetOf(server), options);
		await learnAddress(store, id, server).catch(() => null);
		return;
	}
	const [first] = servers;
	if (!first) throw new Error(SETUP_ERROR["google-oauth"]);
	if (servers.length === 1 && !(await mcpSignedIn(first))) {
		await signInMcp(targetOf(first), { ...options, prompt: ADD_PROMPT });
		await learnAddress(store, id, first).catch(() => null);
		return;
	}
	const name = await freeName(service.serverName);
	const credentialId = `${ACCOUNT_ID_PREFIX}${randomBytes(8).toString("hex")}`;
	const config: McpServerConfig = { type: "http", url: service.url, oauth: first.config.oauth, auth: { type: "oauth", credentialId } };
	await signInMcp({ url: service.url, credentialId, oauth: config.oauth }, { ...options, prompt: ADD_PROMPT });
	const added: McpServer = { name, url: service.url, credentialId, config };
	let address: string;
	try {
		const known = await Promise.all(servers.map(server => store.value.addresses.get(server.name) ?? learnAddress(store, id, server).catch(() => null)));
		address = await ADDRESS_OF[id](signedFetch(async () => mcpBearer(added)));
		if (known.some(other => other?.toLowerCase() === address.toLowerCase())) throw new Error(`${address} is already connected to ${service.label}.`);
	} catch (err) {
		await signOutMcp(added);
		throw err;
	}
	await addMcpServer(name, config);
	store.apply({ kind: "learn", account: name, address });
}

/**
 * Starts the sign-in `target` names, abandoning any of its service under way, and answers once it has the service's
 * authorization address or has failed.
 */
export async function startIntegrationSignIn(store: GoogleAccountsStore, { id, account }: IntegrationTarget): Promise<McpIntegration> {
	const service = MCP_SERVICES[id];
	signInTargets[id] = holdsAccounts(id) ? account : null;
	await signIns[id].start(async (signal, waiting) => {
		if (service.client !== "none" && !(await clientSetup(id))?.configured) throw new Error(SETUP_ERROR[service.client]);
		if (isGoogleService(id)) {
			for (const { name, server } of await planGoogleScope(userMcpConfigPath(), id)) await writeMcpServer(userMcpConfigPath(), name, server);
		}
		if (holdsAccounts(id)) await signInAccount(store, id, account, { signal, waiting });
		else await signInSingle(id, { signal, waiting });
	});
	return loadIntegration(store, id, false);
}

/**
 * Removes `server` of service `id` and its sign-in, the server first, so omp never loads it without its sign-in and
 * falls back to the one filed under the URL.
 */
async function removeAccountServer(store: GoogleAccountsStore, server: McpServer): Promise<void> {
	await removeMcpServer(server.name);
	store.apply({ kind: "forget", accounts: [server.name] });
	await signOutMcp(server);
}

/**
 * Drops the sign-ins made with a client that changed. A service of one server signs out of it. A service of many
 * accounts removes every server but one with its sign-in, and signs out of the one it keeps, which holds the client:
 * the original server, filed under its URL, else the first.
 */
async function dropSignIns(store: GoogleAccountsStore, id: ClientService): Promise<void> {
	const servers = await serversOf(id);
	if (!holdsAccounts(id)) {
		if (servers[0]) await signOutMcp(servers[0]);
		return;
	}
	const kept = servers.find(server => !server.config.auth?.credentialId) ?? servers[0];
	for (const server of servers) if (server !== kept) await removeAccountServer(store, server);
	if (kept) await signOutMcp(kept);
}

/**
 * Saves `id`'s OAuth client, as `plan` makes it from the user MCP config, and answers the integration.
 * A waiting sign-in is cancelled. A new client ID or secret also drops the sign-ins made with the old one.
 */
async function saveClient(store: GoogleAccountsStore, id: ClientService, plan: (path: string) => Promise<ClientSave>): Promise<McpIntegration> {
	const path = userMcpConfigPath();
	const planned = await plan(path);
	signIns[id].cancel();
	for (const { name, server } of planned.writes) await writeMcpServer(path, name, server);
	if (planned.dropCredentials) await dropSignIns(store, id);
	return loadIntegration(store, id, false);
}

export const saveSlackClient = (store: GoogleAccountsStore, input: SlackClientInput): Promise<McpIntegration> =>
	saveClient(store, "slack", path => planSlackSave(path, input));

export const saveGoogleClient = (store: GoogleAccountsStore, id: GoogleService, input: GoogleClientInput): Promise<McpIntegration> =>
	saveClient(store, id, path => planGoogleSave(path, id, input));

/**
 * Abandons a sign-in under way to what `target` names and signs omp out of it. A service of one server keeps its
 * server in omp's config. An account's server is removed with its sign-in, except the last one on its host, which
 * keeps the OAuth client and stays signed out.
 */
export async function removeIntegration(store: GoogleAccountsStore, { id, account }: IntegrationTarget): Promise<McpIntegration> {
	if (!holdsAccounts(id)) {
		signIns[id].cancel();
		const [found] = await serversOf(id);
		if (found) await signOutMcp(found);
		return loadIntegration(store, id, false);
	}
	if (account === null) throw new Error(`Name the ${MCP_SERVICES[id].label} account to remove.`);
	if (signInTargets[id] === account) signIns[id].cancel();
	const servers = await serversOf(id);
	const server = servers.find(candidate => candidate.name === account);
	if (!server) throw new Error(`${MCP_SERVICES[id].label} has no account "${account}".`);
	if (servers.length > 1) await removeAccountServer(store, server);
	else await signOutMcp(server);
	return loadIntegration(store, id, false);
}

/** Links Google address `address`'s accounts, Gmail's and Google Calendar's, to `workspaces`, and answers every integration. */
export async function linkGoogleAccount(store: GoogleAccountsStore, { address, workspaces }: GoogleLinks): Promise<IntegrationsAnswer> {
	store.apply({ kind: "link", address, workspaces });
	return loadIntegrations(store, false);
}
