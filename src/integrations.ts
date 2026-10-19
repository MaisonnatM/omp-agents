/**
 * The services whose MCP server the integrations page signs omp in to: where omp stands with each, checked by listing
 * the server's tools, and the sign-ins and removals the page starts. Linear and Slack sign in to the first server on
 * their host, and a sign-in adds it to omp's user-level MCP config when omp has none. Gmail and Google Calendar hold an
 * account per server on their host, as `src/google-accounts.ts` keeps them.
 */
import type { GoogleAccounts } from "./google-accounts";
import { clientSetup, type ClientSave, planGoogleSave, planSlackSave } from "./mcp-clients";
import { remoteStatusOf } from "./mcp-status";
import { addMcpServer, findMcpServers, mcpBearer, type McpServer, mcpSignedIn, signInMcp, signOutMcp, userMcpConfigPath, writeMcpServer } from "./omp/mcp";
import {
	type AccountId,
	type ClientService,
	type GoogleAccount,
	type GoogleClientInput,
	type GoogleLinks,
	type GoogleService,
	hasAccounts,
	holdsAccounts,
	type IntegrationSignIn,
	type IntegrationsAnswer,
	type IntegrationTarget,
	MCP_INTEGRATIONS,
	MCP_SERVICES,
	type McpClient,
	type McpConnection,
	type McpIntegration,
	type McpIntegrationId,
	serverConnection,
	type SingleService,
	type SlackClientInput,
} from "./shared/accounts";
import { createSignIn, type SignIn } from "./sign-in";
import { type SignedFetch, signedFetch } from "./signed-fetch";

/**
 * What Settings › Integrations does with one service: its one server's connection, or each of its accounts. A sign-in
 * and a removal name an account, `null` to add one or for a service of one server.
 */
export interface IntegrationKind<Connections extends { connection: McpConnection } | { accounts: GoogleAccount[] }> {
	/** Where omp stands with the service; what `signIn` targets keeps its status while the sign-in waits on the browser. */
	load(fresh: boolean, signIn: SignIn<AccountId | null>): Promise<Connections>;
	signIn(account: AccountId | null, signal: AbortSignal, waiting: (url: string) => void): Promise<void>;
	remove(account: AccountId | null): Promise<void>;
	/** Drops the sign-ins made with an OAuth client that changed. */
	dropSignIns(): Promise<void>;
}

const serversOf = (id: McpIntegrationId): Promise<McpServer[]> => findMcpServers(MCP_SERVICES[id].host);

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

/**
 * Service `id`'s first server, which every service requires a sign-in to. A sign-in signs in to it, else to its URL
 * and adds its server once the browser comes back. A removal signs out of it and keeps it in omp's config.
 */
function singleServer(id: SingleService): IntegrationKind<{ connection: McpConnection }> {
	const service = MCP_SERVICES[id];
	const signOut = async (): Promise<void> => {
		const [found] = await serversOf(id);
		if (found) await signOutMcp(found);
	};
	return {
		async load(fresh, signIn) {
			const [found] = await serversOf(id);
			if (!found) return { connection: { kind: "absent" } };
			const status = await signIn.hold(null, async () => remoteStatusOf(found, { signedIn: await mcpSignedIn(found), signInRequired: true }, fresh));
			return { connection: serverConnection(found, status) };
		},
		async signIn(_account, signal, waiting) {
			const [found] = await serversOf(id);
			await signInMcp(found ? { url: found.url, credentialId: found.credentialId, oauth: found.config.oauth } : { url: service.url }, { onAuth: waiting, signal, requireRefresh: service.requireRefresh });
			if (!found) await addMcpServer(service.serverName, { type: "http", url: service.url });
		},
		remove: signOut,
		dropSignIns: signOut,
	};
}

const SETUP_ERROR: Record<Exclude<McpClient, "none">, string> = {
	"slack-app": "Set up the Slack app before connecting. Save a client ID, client secret, HTTPS redirect, callback port, and at least one supported scope.",
	"google-oauth": "Set up the Google OAuth client before connecting. Save its client ID, client secret, and callback port.",
};

/** What `GET /api/integrations` and the integration writes do. */
export interface Integrations {
	/**
	 * Every integration; `fresh` lists each signed-in server's tools again rather than the minute-old list. The addresses
	 * kept for accounts whose server is gone once the integrations are read are forgotten.
	 */
	load(fresh: boolean): Promise<IntegrationsAnswer>;
	/** Starts the sign-in `target` names, abandoning any of its service under way, and answers once it has the authorization address or has failed. */
	startSignIn(target: IntegrationTarget): Promise<McpIntegration>;
	/** Abandons a sign-in under way to what `target` names and signs omp out of it. */
	remove(target: IntegrationTarget): Promise<McpIntegration>;
	saveSlackClient(input: SlackClientInput): Promise<McpIntegration>;
	saveGoogleClient(id: GoogleService, input: GoogleClientInput): Promise<McpIntegration>;
	/** Links Google address `address`'s accounts to `workspaces`, and answers every integration. */
	linkGoogleAccount(links: GoogleLinks): Promise<IntegrationsAnswer>;
}

/** The integrations, Gmail's and Google Calendar's as `googleAccounts` keeps them. */
export function createIntegrations(googleAccounts: GoogleAccounts): Integrations {
	const signIns = Object.fromEntries(
		MCP_INTEGRATIONS.map(id => [id, createSignIn<AccountId | null>(`${MCP_SERVICES[id].label}'s sign-in page was not completed within 5 minutes. Try again.`)]),
	) as Record<McpIntegrationId, SignIn<AccountId | null>>;

	const kindOf = (id: McpIntegrationId): IntegrationKind<{ connection: McpConnection } | { accounts: GoogleAccount[] }> =>
		holdsAccounts(id) ? googleAccounts.of(id) : singleServer(id);

	const signInOf = (id: McpIntegrationId): IntegrationSignIn => {
		const attempt = signIns[id].state();
		return attempt?.signIn ? { ...attempt.signIn, account: attempt.target } : null;
	};

	const load = async (id: McpIntegrationId, fresh: boolean): Promise<McpIntegration> =>
		({ id, ...(await kindOf(id).load(fresh, signIns[id])), signIn: signInOf(id), setup: await clientSetup(id) }) as McpIntegration;

	/**
	 * Saves `id`'s OAuth client, as `plan` makes it from the user MCP config, and answers the integration.
	 * A waiting sign-in is cancelled. A new client ID or secret also drops the sign-ins made with the old one.
	 */
	const saveClient = async (id: ClientService, plan: (path: string) => Promise<ClientSave>): Promise<McpIntegration> => {
		const path = userMcpConfigPath();
		const planned = await plan(path);
		signIns[id].cancel();
		for (const { name, server } of planned.writes) await writeMcpServer(path, name, server);
		if (planned.dropCredentials) await kindOf(id).dropSignIns();
		return load(id, false);
	};

	const integrations: Integrations = {
		async load(fresh) {
			const loaded = await Promise.all(MCP_INTEGRATIONS.map(id => load(id, fresh)));
			googleAccounts.forgetGone(new Set(loaded.filter(hasAccounts).flatMap(integration => integration.accounts.map(account => account.name))));
			return { integrations: Object.fromEntries(loaded.map(integration => [integration.id, integration])) as IntegrationsAnswer["integrations"] };
		},

		async startSignIn({ id, account }) {
			const service = MCP_SERVICES[id];
			await signIns[id].start(account, async (signal, waiting) => {
				if (service.client !== "none" && !(await clientSetup(id))?.configured) throw new Error(SETUP_ERROR[service.client]);
				await kindOf(id).signIn(account, signal, waiting);
			});
			return load(id, false);
		},

		async remove({ id, account }) {
			if (signIns[id].state()?.target === account) signIns[id].cancel();
			await kindOf(id).remove(account);
			return load(id, false);
		},

		saveSlackClient: input => saveClient("slack", path => planSlackSave(path, input)),

		saveGoogleClient: (id, input) => saveClient(id, path => planGoogleSave(path, id, input)),

		async linkGoogleAccount(links) {
			googleAccounts.link(links);
			return integrations.load(false);
		},
	};
	return integrations;
}
