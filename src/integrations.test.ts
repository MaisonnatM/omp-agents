import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClients, claimAddress, keepAddedAccount, keepSignIn, linkGoogleAccount, removeIntegration } from "./integrations";
import { auth, mcpCredentials } from "./omp/modules";
import { type McpServer, type McpServerConfig, userMcpConfigPath, writeMcpServer } from "./omp/mcp";
import { GoogleAccountsFile } from "./server/google-accounts-file";

const GMAIL = "https://gmailmcp.googleapis.com/mcp/v1";
const URL_ID = mcpCredentials.mcpOAuthCredentialIdsForServerUrl(GMAIL)[0] as string;
const ADDED_ID = "mcp_oauth_omp_agents_0123456789abcdef";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	rmSync(userMcpConfigPath(), { force: true });
	const storage = await auth.discoverAuthStorage();
	try {
		await mcpCredentials.removeManagedMcpOAuthCredentials(storage, [URL_ID, ADDED_ID]);
	} finally {
		storage.close();
	}
});

function accountsStore(addresses: Record<string, string>): GoogleAccountsFile {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-integrations-"));
	dirs.push(dir);
	const path = join(dir, "google-accounts.json");
	writeFileSync(path, JSON.stringify({ addresses, links: {} }));
	return new GoogleAccountsFile(path);
}

/** Stores a sign-in under each of `ids` in the test's scratch omp credential store, as omp's sign-in does. */
async function signIn(...ids: string[]): Promise<void> {
	const storage = await auth.discoverAuthStorage();
	try {
		// Expired and without a refresh token, so `omp token` fails at once and a status read never calls Google.
		for (const id of ids) await storage.credentials.set(id, { type: "oauth", access: "a", expires: 0 });
	} finally {
		storage.close();
	}
}

async function signedIn(): Promise<string[]> {
	const storage = await auth.discoverAuthStorage();
	try {
		return [URL_ID, ADDED_ID].filter(id => storage.credentials.hasOAuth(id));
	} finally {
		storage.close();
	}
}

const servers = (): string[] => Object.keys(JSON.parse(readFileSync(userMcpConfigPath(), "utf8")).mcpServers);

/** Makes omp's user MCP config hold `servers`, through omp's writer, so omp drops its cached read of the file. */
async function configure(servers: Record<string, object>): Promise<void> {
	writeFileSync(userMcpConfigPath(), JSON.stringify({ mcpServers: {} }));
	for (const [name, server] of Object.entries(servers)) await writeMcpServer(userMcpConfigPath(), name, server as McpServerConfig);
}

const ORIGINAL = { type: "http", url: GMAIL };
const ADDED = { type: "http", url: GMAIL, auth: { type: "oauth", credentialId: ADDED_ID } };

test("removing an added account deletes its server, its address, and its own sign-in, and keeps the original's under the URL", async () => {
	await configure({ gmail: ORIGINAL, "gmail-2": ADDED });
	await signIn(URL_ID, ADDED_ID);
	const store = accountsStore({ gmail: "ana@example.com", "gmail-2": "ana@work.example" });
	const answer = await removeIntegration(store, { id: "gmail", account: "gmail-2" });
	expect(servers()).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([URL_ID]);
	expect("accounts" in answer && answer.accounts.map(account => [account.name, account.connection.kind])).toEqual([["gmail", "failing"]]);
});

test("removing the last account on the host signs it out and keeps its server, which holds the OAuth client", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID);
	const store = accountsStore({ gmail: "ana@example.com" });
	const answer = await removeIntegration(store, { id: "gmail", account: "gmail" });
	expect(servers()).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([]);
	expect("accounts" in answer && answer.accounts.map(account => [account.name, account.connection.kind])).toEqual([["gmail", "signed-out"]]);
});

const added: McpServer = { name: "gmail-2", url: GMAIL, credentialId: ADDED_ID, config: ADDED as McpServer["config"] };
const original: McpServer = { name: "gmail", url: GMAIL, credentialId: URL_ID, config: ORIGINAL as McpServer["config"] };

test("an added account whose address another account already signs in as is refused, and leaves neither a server nor its sign-in", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID, ADDED_ID);
	const store = accountsStore({ gmail: "ana@example.com" });
	await expect(keepAddedAccount(store, "gmail", added, async () => "Ana@Example.com")).rejects.toThrow("ana@example.com is already connected to Gmail.");
	expect(servers()).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([URL_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com" });
});

test("an added account whose address cannot be read is dropped the same way; a new address is written with its server", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID, ADDED_ID);
	const store = accountsStore({});
	const addresses: Record<string, string> = { gmail: "ana@example.com" };
	await expect(
		keepAddedAccount(store, "gmail", added, async server => {
			const address = addresses[server.name];
			if (!address) throw new Error("Google answered 500");
			return address;
		}),
	).rejects.toThrow("Google answered 500");
	expect(servers()).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([URL_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com" });

	await signIn(ADDED_ID);
	addresses["gmail-2"] = "Ana@Work.Example";
	await keepAddedAccount(store, "gmail", added, async server => addresses[server.name] as string);
	expect(JSON.parse(readFileSync(userMcpConfigPath(), "utf8")).mcpServers["gmail-2"]).toEqual(ADDED);
	expect(await signedIn()).toEqual([URL_ID, ADDED_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com", "gmail-2": "ana@work.example" });
});

test("an added account whose server omp's config refuses keeps neither its address nor its sign-in", async () => {
	const other = { type: "http", url: "https://example.com/mcp" };
	await configure({ gmail: ORIGINAL, "gmail-2": other });
	await signIn(URL_ID, ADDED_ID);
	const store = accountsStore({ gmail: "ana@example.com" });
	await expect(keepAddedAccount(store, "gmail", added, async () => "ana@work.example")).rejects.toThrow('Server "gmail-2" already exists');
	expect(JSON.parse(readFileSync(userMcpConfigPath(), "utf8")).mcpServers).toEqual({ gmail: ORIGINAL, "gmail-2": other });
	expect(await signedIn()).toEqual([URL_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com" });
});

test("a reconnect that signs in as an address another account holds is refused and signed out, and keeps its server and old address", async () => {
	await configure({ gmail: ORIGINAL, "gmail-2": ADDED });
	await signIn(URL_ID, ADDED_ID);
	const store = accountsStore({ gmail: "ana@example.com", "gmail-2": "ana@work.example" });
	await expect(keepSignIn(store, "gmail", added, async () => "ANA@example.com")).rejects.toThrow("ana@example.com is already connected to Gmail.");
	expect(servers()).toEqual(["gmail", "gmail-2"]);
	expect(await signedIn()).toEqual([URL_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com", "gmail-2": "ana@work.example" });
});

test("a Gmail and a Google Calendar account whose addresses differ only in case share one workspace link", async () => {
	const calendar = { type: "http", url: "https://calendarmcp.googleapis.com/mcp/v1" };
	await configure({ gmail: ORIGINAL, "google-calendar": calendar });
	const store = accountsStore({});
	await claimAddress(store, "gmail", original, async () => "Ana@Example.com");
	const calendarServer: McpServer = { name: "google-calendar", url: calendar.url, credentialId: "calendar", config: calendar as McpServer["config"] };
	await claimAddress(store, "google-calendar", calendarServer, async () => "ana@EXAMPLE.com");
	const { integrations } = await linkGoogleAccount(store, { address: "ANA@example.com", workspaces: ["/work"] });
	const linked = [...integrations.gmail.accounts, ...integrations["google-calendar"].accounts].map(({ name, address, workspaces }) => ({ name, address, workspaces }));
	expect(linked).toEqual([
		{ name: "gmail", address: "ana@example.com", workspaces: ["/work"] },
		{ name: "google-calendar", address: "ana@example.com", workspaces: ["/work"] },
	]);
});

test("an account's client is made again once it signs out, though its server keeps its credential id", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID);
	let made = 0;
	const clients = accountClients("gmail", () => ({ made: ++made }));
	expect(await clients.get("gmail")).toEqual({ made: 1 });
	expect(await clients.get("gmail")).toEqual({ made: 1 });
	await removeIntegration(accountsStore({ gmail: "ana@example.com" }), { id: "gmail", account: "gmail" });
	expect(await clients.get("gmail")).toEqual({ made: 2 });
});
