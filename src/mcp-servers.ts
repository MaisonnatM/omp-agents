/**
 * Settings › MCP servers: every user-level MCP server omp loads, checked with omp's own client, and the adds,
 * sign-ins, sign-outs, enables, and removals the page starts. Only servers in omp's own user `mcp.json` change here;
 * Settings › Integrations' services keep their own section.
 */
import { remoteStatusOf } from "./mcp-status";
import {
	addMcpServer,
	type ConfiguredMcpServer,
	credentialFor,
	listMcpServers,
	type McpServer,
	type McpServerConfig,
	mcpServerNameError,
	mcpSignedInIds,
	removeMcpServer,
	setMcpServerEnabled,
	signInMcp,
	signOutMcp,
	userMcpConfigPath,
} from "./omp/mcp";
import { integrationOn, MCP_SERVICES } from "./shared/accounts";
import { catalogEntry, catalogEntryOn } from "./shared/mcp-catalog";
import type { McpServerAdd, McpServerRow, McpServerStatus, McpServersAnswer } from "./shared/mcp-servers";
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

/** `server` with the credential id omp files its sign-in under; `null` for a local command or an address that does not parse. */
function remoteOf({ name, config }: ConfiguredMcpServer): McpServer | null {
	try {
		return credentialFor(name, config);
	} catch {
		return null;
	}
}

async function rowOf(server: ConfiguredMcpServer, remote: McpServer | null, signedIn: boolean, fresh: boolean): Promise<McpServerRow> {
	const { name, config, source, enabled } = server;
	const host = remote && new URL(remote.url).host;
	const transport = config.type === "sse" ? "sse" : config.type === "stdio" || (!config.type && !config.url) ? "stdio" : "http";
	const integration = integrationOn(host);
	const signIn = signIns.get(name)?.state() ?? null;
	let status: McpServerStatus;
	if (!enabled) status = { kind: "disabled" };
	else if (integration) status = { kind: "integration", id: integration };
	else if (transport === "stdio") status = { kind: "local" };
	else if (!remote) status = { kind: "failing", error: `Its address, ${config.url ?? "missing"}, is not a URL.`, status: null };
	else status = await signInOf(name).hold(() => remoteStatusOf(remote, { signedIn, signInRequired: false }, fresh));
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
	const integration = integrationOn(new URL(remote.url).host);
	if (integration) throw new McpServerRejected(`Connect ${MCP_SERVICES[integration].label} in Settings › Integrations.`);
	return remote;
}

/** Starts a sign-in to server `name`, abandoning any under way, and answers once it has the authorization address or has failed. */
export async function startMcpServerSignIn(name: string): Promise<McpServerRow> {
	const remote = signable(await configured(name));
	await signInOf(name).start(async (signal, waiting) => {
		await signInMcp(remote, { onAuth: waiting, signal });
	});
	return rowNamed(name);
}

/** Abandons a sign-in to server `name` under way and removes the sign-ins omp manages for it; its config stays. */
export async function signOutMcpServer(name: string): Promise<McpServerRow> {
	const remote = signable(await configured(name));
	signIns.get(name)?.cancel();
	await signOutMcp(remote);
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
		return entry.auth === "oauth" ? startMcpServerSignIn(name) : rowNamed(name);
	}
	const nameError = mcpServerNameError(add.name);
	if (nameError) throw new McpServerRejected(nameError);
	if (taken.has(add.name)) throw new McpServerRejected(`omp already loads a server named "${add.name}".`);
	const config: McpServerConfig = { type: add.transport, url: add.url };
	if (add.header) config.headers = { [add.header.name]: add.header.value };
	await addMcpServer(add.name, config);
	return rowNamed(add.name);
}

/** Turns server `name` on or off for new omp sessions, as `/mcp enable` and `/mcp disable` do. */
export async function setMcpServerEnabledFrom(name: string, enabled: boolean): Promise<McpServerRow> {
	editable(await configured(name));
	signIns.get(name)?.cancel();
	await setMcpServerEnabled(name, enabled);
	return rowNamed(name);
}

/** Removes server `name` from omp's user `mcp.json`, as `/mcp remove` does: omp keeps its sign-in. */
export async function removeMcpServerNamed(name: string): Promise<void> {
	editable(await configured(name));
	signIns.get(name)?.cancel();
	signIns.delete(name);
	await removeMcpServer(name);
}
