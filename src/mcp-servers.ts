/**
 * Settings › MCP servers: every user-level MCP server omp loads, checked with omp's own client, and the adds,
 * sign-ins, sign-outs, enables, and removals the page starts. Only servers in omp's own user `mcp.json` change here;
 * Settings › Integrations' services keep their own section.
 */
import { errorText } from "./json";
import {
	addMcpServer,
	type ConfiguredMcpServer,
	credentialFor,
	forgetMcpTools,
	listMcpServers,
	listMcpTools,
	type McpServer,
	type McpServerConfig,
	mcpServerNameError,
	mcpSignedInIds,
	McpUnauthorized,
	removeMcpServer,
	setMcpServerEnabled,
	signInMcp,
	signOutMcp,
	userMcpConfigPath,
} from "./omp/mcp";
import { MCP_INTEGRATIONS, MCP_SERVICES } from "./shared/accounts";
import { catalogEntry, catalogEntryOn } from "./shared/mcp-catalog";
import type { McpServerAdd, McpServerRow, McpServerStatus, McpServersAnswer, McpTool } from "./shared/mcp-servers";
import { createSignIn, type SignIn } from "./sign-in";

/** A change the page asked for that omp's config does not allow, answered as a 400 with its message. */
export class McpServerRejected extends Error {}

const signIns = new Map<string, SignIn>();

function signInOf(name: string): SignIn {
	let signIn = signIns.get(name);
	if (!signIn) {
		signIn = createSignIn(`${name}'s sign-in page was not completed within 5 minutes. Try again.`);
		signIns.set(name, signIn);
	}
	return signIn;
}

/** Each server's status as last answered, which a read repeats while its sign-in waits on the browser. */
const lastStatuses = new Map<string, McpServerStatus>();

/** `server` with the credential id omp files its sign-in under; `null` for a local command or an address that does not parse. */
function remoteOf({ name, config }: ConfiguredMcpServer): McpServer | null {
	try {
		return credentialFor(name, config);
	} catch {
		return null;
	}
}

/**
 * Where omp stands with a remote server, from `tools`, its tool list read with omp's sign-in when `signedIn`: a 401
 * is a sign-in to start when omp holds none, and a refused one when it does.
 */
export async function statusOf(signedIn: boolean, tools: () => Promise<McpTool[]>): Promise<McpServerStatus> {
	try {
		return { kind: "ready", tools: await tools() };
	} catch (err) {
		if (!(err instanceof McpUnauthorized)) return { kind: "failing", error: errorText(err) };
		return signedIn ? { kind: "refused", error: "The server refused omp's sign-in. Reconnect to sign in again." } : { kind: "signed-out" };
	}
}

async function rowOf(server: ConfiguredMcpServer, remote: McpServer | null, signedIn: boolean, fresh: boolean): Promise<McpServerRow> {
	const { name, config, source, enabled } = server;
	const host = remote && new URL(remote.url).host;
	const transport = config.type === "sse" ? "sse" : config.type === "stdio" || (!config.type && !config.url) ? "stdio" : "http";
	const integration = MCP_INTEGRATIONS.find(id => MCP_SERVICES[id].host === host);
	const signIn = signIns.get(name)?.state() ?? null;
	const last = lastStatuses.get(name);
	let status: McpServerStatus;
	if (!enabled) status = { kind: "disabled" };
	else if (integration) status = { kind: "integration", id: integration };
	else if (transport === "stdio") status = { kind: "local" };
	else if (!remote) status = { kind: "failing", error: `Its address, ${config.url ?? "missing"}, is not a URL.` };
	else if (signIn?.phase === "waiting" && last) status = last;
	else {
		status = await statusOf(signedIn, async () =>
			(await listMcpTools(name, config, signedIn ? remote.credentialId : null, fresh)).map(tool => ({ name: tool.name, description: tool.description?.trim() || null })),
		);
	}
	lastStatuses.set(name, status);
	return {
		name,
		transport,
		url: remote?.url ?? config.url ?? null,
		host,
		command: config.command ?? null,
		source: { label: source.providerName, path: source.path, editable: source.provider === "native" && source.level === "user" },
		signedIn,
		status,
		signIn,
		catalogId: catalogEntryOn(host)?.id ?? null,
	};
}

async function rowsOf(servers: ConfiguredMcpServer[], fresh: boolean): Promise<McpServerRow[]> {
	const remotes = servers.map(remoteOf);
	const signedIn = await mcpSignedInIds(remotes.flatMap(remote => (remote ? [remote.credentialId] : [])));
	return Promise.all(servers.map((server, i) => rowOf(server, remotes[i], !!remotes[i] && signedIn.has(remotes[i].credentialId), fresh)));
}

/** Every server omp loads for you; `fresh` lists each one's tools again rather than the minute-old list. */
export async function loadMcpServers(fresh: boolean): Promise<McpServersAnswer> {
	return { servers: await rowsOf(await listMcpServers(), fresh), configPath: userMcpConfigPath() };
}

async function configured(name: string): Promise<ConfiguredMcpServer> {
	const server = (await listMcpServers()).find(candidate => candidate.name === name);
	if (!server) throw new McpServerRejected(`omp loads no MCP server named "${name}".`);
	return server;
}

async function rowNamed(name: string): Promise<McpServerRow> {
	const [row] = await rowsOf([await configured(name)], false);
	return row;
}

/** `server`, once it is in omp's own user `mcp.json`, the only file the page writes. */
function editable(server: ConfiguredMcpServer): ConfiguredMcpServer {
	if (server.source.provider === "native" && server.source.level === "user") return server;
	throw new McpServerRejected(`"${server.name}" is defined in ${server.source.providerName}'s ${server.source.path}. Change it there.`);
}

/** `server`'s address and credential id, once it is a remote server that is not one of Settings › Integrations' services. */
function signable(server: ConfiguredMcpServer): McpServer {
	const remote = remoteOf(server);
	if (!remote) throw new McpServerRejected(`"${server.name}" runs a local command, which takes no sign-in.`);
	const integration = MCP_INTEGRATIONS.find(id => MCP_SERVICES[id].host === new URL(remote.url).host);
	if (integration) throw new McpServerRejected(`Connect ${MCP_SERVICES[integration].label} in Settings › Integrations.`);
	return remote;
}

/** Starts a sign-in to server `name`, abandoning any under way, and answers once it has the authorization address or has failed. */
export async function startMcpServerSignIn(name: string): Promise<McpServerRow> {
	const remote = signable(await configured(name));
	await signInOf(name).start(async (signal, waiting) => {
		await signInMcp(remote, { onAuth: waiting, signal });
		forgetMcpTools(name);
	});
	return rowNamed(name);
}

/** Abandons a sign-in to server `name` under way and removes the sign-ins omp manages for it; its config stays. */
export async function signOutMcpServer(name: string): Promise<McpServerRow> {
	const remote = signable(await configured(name));
	signIns.get(name)?.cancel();
	await signOutMcp(remote);
	forgetMcpTools(name);
	return rowNamed(name);
}

/**
 * Adds a catalog entry, under its id or the first free `<id>-<n>`, or a server by its address, to omp's user `mcp.json`.
 * Adding a catalog entry that signs in with OAuth starts that sign-in.
 */
export async function addMcpServerFrom(add: McpServerAdd): Promise<McpServerRow> {
	const servers = await listMcpServers();
	const taken = new Set(servers.map(server => server.name));
	if (add.kind === "catalog") {
		const entry = catalogEntry(add.id);
		if (!entry) throw new McpServerRejected(`The catalog has no server "${add.id}".`);
		const existing = servers.find(server => {
			const remote = remoteOf(server);
			return remote && catalogEntryOn(new URL(remote.url).host) === entry;
		});
		if (existing) throw new McpServerRejected(`${entry.label} is already added as "${existing.name}".`);
		let name = entry.id;
		for (let n = 2; taken.has(name); n++) name = `${entry.id}-${n}`;
		await addMcpServer(name, { type: entry.transport, url: entry.url });
		forgetMcpTools(name);
		return entry.auth === "oauth" ? startMcpServerSignIn(name) : rowNamed(name);
	}
	const nameError = mcpServerNameError(add.name);
	if (nameError) throw new McpServerRejected(nameError);
	if (taken.has(add.name)) throw new McpServerRejected(`omp already loads a server named "${add.name}".`);
	const config: McpServerConfig = { type: add.transport, url: add.url };
	if (add.header) config.headers = { [add.header.name]: add.header.value };
	await addMcpServer(add.name, config);
	forgetMcpTools(add.name);
	return rowNamed(add.name);
}

/** Turns server `name` on or off for new omp sessions, as `/mcp enable` and `/mcp disable` do. */
export async function setMcpServerEnabledFrom(name: string, enabled: boolean): Promise<McpServerRow> {
	editable(await configured(name));
	signIns.get(name)?.cancel();
	await setMcpServerEnabled(name, enabled);
	forgetMcpTools(name);
	return rowNamed(name);
}

/** Removes server `name` from omp's user `mcp.json`, as `/mcp remove` does: omp keeps its sign-in. */
export async function removeMcpServerNamed(name: string): Promise<void> {
	editable(await configured(name));
	signIns.get(name)?.cancel();
	signIns.delete(name);
	lastStatuses.delete(name);
	await removeMcpServer(name);
	forgetMcpTools(name);
}
