import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClients, createGoogleAccounts } from "./google-accounts";
import { createIntegrations, type Integrations } from "./integrations";
import { auth, mcpCredentials } from "./omp/modules";
import { type McpServerConfig, type McpSignInTarget, userMcpConfigPath, writeMcpServer } from "./omp/mcp";
import { GoogleAccountsFile } from "./server/google-accounts-file";
import type { McpIntegration } from "./shared/accounts";

const GMAIL = "https://gmailmcp.googleapis.com/mcp/v1";
const CALENDAR = "https://calendarmcp.googleapis.com/mcp/v1";
const URL_ID = mcpCredentials.mcpOAuthCredentialIdsForServerUrl(GMAIL)[0] as string;
const ADDED_ID = "mcp_oauth_omp_agents_0123456789abcdef";
const OAUTH = { clientId: "1-a.apps.googleusercontent.com", clientSecret: "secret", callbackPort: 3119 };
const ORIGINAL = { type: "http", url: GMAIL, oauth: OAUTH };
const ADDED = { type: "http", url: GMAIL, oauth: OAUTH, auth: { type: "oauth", credentialId: ADDED_ID } };
/** What Google answers for a token of this address: an error, so the address cannot be read. */
const UNREADABLE = "unreadable@example.com";

const dirs: string[] = [];
const signedInIds = new Set<string>([URL_ID, ADDED_ID]);
/** The address each next browser sign-in signs in as. */
const browser: string[] = [];

beforeEach(() => {
	const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const address = request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
		const profile = request.url === "https://gmail.googleapis.com/gmail/v1/users/me/profile" ? { emailAddress: address } : request.url === "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary" ? { id: address } : null;
		if (!profile || address === UNREADABLE) return Response.json({ error: { message: "Google answered 500" } }, { status: 500 });
		return Response.json(profile);
	};
	spyOn(globalThis, "fetch").mockImplementation(Object.assign(stub, { preconnect: fetch.preconnect }));
});

afterEach(async () => {
	mock.restore();
	browser.length = 0;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	rmSync(userMcpConfigPath(), { force: true });
	const storage = await auth.discoverAuthStorage();
	try {
		await mcpCredentials.removeManagedMcpOAuthCredentials(storage, [...signedInIds]);
	} finally {
		storage.close();
	}
});

/** Stores a sign-in as `address` under `id` in the test's scratch omp credential store, as omp's sign-in does; its token is the address. */
async function signIn(id: string, address: string): Promise<void> {
	signedInIds.add(id);
	const storage = await auth.discoverAuthStorage();
	try {
		await storage.credentials.set(id, { type: "oauth", access: address, expires: Date.now() + 3_600_000 });
	} finally {
		storage.close();
	}
}

async function signedIn(): Promise<string[]> {
	const storage = await auth.discoverAuthStorage();
	try {
		return [...signedInIds].filter(id => storage.credentials.hasOAuth(id));
	} finally {
		storage.close();
	}
}

const config = (): Record<string, McpServerConfig> => JSON.parse(readFileSync(userMcpConfigPath(), "utf8")).mcpServers;

/** Makes omp's user MCP config hold `servers`, through omp's writer, so omp drops its cached read of the file. */
async function configure(servers: Record<string, object>): Promise<void> {
	writeFileSync(userMcpConfigPath(), JSON.stringify({ mcpServers: {} }));
	for (const [name, server] of Object.entries(servers)) await writeMcpServer(userMcpConfigPath(), name, server as McpServerConfig);
}

/** The integrations with the Google accounts kept in a scratch `google-accounts.json` holding `addresses`, signing in as {@link browser} says. */
function integrationsWith(addresses: Record<string, string>): { integrations: Integrations; store: GoogleAccountsFile } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-google-accounts-"));
	dirs.push(dir);
	const path = join(dir, "google-accounts.json");
	writeFileSync(path, JSON.stringify({ addresses, links: {} }));
	const store = new GoogleAccountsFile(path);
	const grant = async (target: McpSignInTarget): Promise<void> => signIn(target.credentialId as string, browser.shift() as string);
	return { integrations: createIntegrations(createGoogleAccounts(store, grant)), store };
}

const accountsOf = (integration: McpIntegration) => ("accounts" in integration ? integration.accounts : []);

test("removing an added account deletes its server, its address, and its own sign-in, and keeps the original's under the URL", async () => {
	await configure({ gmail: ORIGINAL, "gmail-2": ADDED });
	await signIn(URL_ID, "ana@example.com");
	await signIn(ADDED_ID, "ana@work.example");
	const { integrations, store } = integrationsWith({ gmail: "ana@example.com", "gmail-2": "ana@work.example" });
	const answer = await integrations.remove({ id: "gmail", account: "gmail-2" });
	expect(Object.keys(config())).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([URL_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com" });
	expect(accountsOf(answer).map(account => account.name)).toEqual(["gmail"]);
});

test("removing the last account on the host signs it out and keeps its server, which holds the OAuth client", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID, "ana@example.com");
	const { integrations } = integrationsWith({ gmail: "ana@example.com" });
	const answer = await integrations.remove({ id: "gmail", account: "gmail" });
	expect(Object.keys(config())).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([]);
	expect(accountsOf(answer).map(account => [account.name, account.connection.kind])).toEqual([["gmail", "signed-out"]]);
});

test("an added account gets a server of its own, named after the first free name, with a credential id of its own", async () => {
	const other = { type: "http", url: "https://example.com/mcp" };
	await configure({ gmail: ORIGINAL, "gmail-2": other });
	await signIn(URL_ID, "ana@example.com");
	const { integrations, store } = integrationsWith({ gmail: "ana@example.com" });
	browser.push("Ana@Work.Example");
	const answer = await integrations.startSignIn({ id: "gmail", account: null });
	expect(answer.signIn).toBeNull();
	const added = config()["gmail-3"];
	expect(added?.auth?.credentialId).toStartWith("mcp_oauth_omp_agents_");
	expect(config()["gmail-2"]).toEqual(other);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com", "gmail-3": "ana@work.example" });
	signedInIds.add(added?.auth?.credentialId as string);
	expect(await signedIn()).toEqual([URL_ID, added?.auth?.credentialId as string]);
});

test("an added account whose address another account already signs in as is refused, and leaves neither a server nor its sign-in", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID, "ana@example.com");
	const { integrations, store } = integrationsWith({ gmail: "ana@example.com" });
	browser.push("Ana@Example.com");
	const answer = await integrations.startSignIn({ id: "gmail", account: null });
	expect(answer.signIn).toEqual({ phase: "failed", error: "ana@example.com is already connected to Gmail.", account: null });
	expect(Object.keys(config())).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([URL_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com" });
});

test("an added account whose address cannot be read is dropped the same way, and the address read for another account is kept", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID, "ana@example.com");
	const { integrations, store } = integrationsWith({});
	browser.push(UNREADABLE);
	const answer = await integrations.startSignIn({ id: "gmail", account: null });
	expect(answer.signIn).toEqual({ phase: "failed", error: "Google answered 500", account: null });
	expect(Object.keys(config())).toEqual(["gmail"]);
	expect(await signedIn()).toEqual([URL_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com" });
});

test("a reconnect that signs in as an address another account holds is refused, and keeps its server, its sign-in, and its old address", async () => {
	await configure({ gmail: ORIGINAL, "gmail-2": ADDED });
	await signIn(URL_ID, "ana@example.com");
	await signIn(ADDED_ID, "ana@work.example");
	const { integrations, store } = integrationsWith({ gmail: "ana@example.com", "gmail-2": "ana@work.example" });
	browser.push("ANA@example.com");
	const answer = await integrations.startSignIn({ id: "gmail", account: "gmail-2" });
	expect(answer.signIn).toEqual({ phase: "failed", error: "ana@example.com is already connected to Gmail.", account: "gmail-2" });
	expect(config()["gmail-2"]?.auth?.credentialId).toBe(ADDED_ID);
	expect(await signedIn()).toEqual([URL_ID, ADDED_ID]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@example.com", "gmail-2": "ana@work.example" });
});

test("a reconnect of the server filed under its URL moves it to a credential id of its own, and its client is made again", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID, "ana@example.com");
	const { integrations, store } = integrationsWith({ gmail: "ana@example.com" });
	let made = 0;
	const clients = accountClients("gmail", () => ({ made: ++made }));
	expect(await clients.get("gmail")).toEqual({ made: 1 });
	expect(await clients.get("gmail")).toEqual({ made: 1 });
	browser.push("ana@home.example");
	expect((await integrations.startSignIn({ id: "gmail", account: "gmail" })).signIn).toBeNull();
	const credentialId = config().gmail?.auth?.credentialId as string;
	expect(credentialId).toStartWith("mcp_oauth_omp_agents_");
	signedInIds.add(credentialId);
	expect(await signedIn()).toEqual([credentialId]);
	expect(Object.fromEntries(store.value.addresses)).toEqual({ gmail: "ana@home.example" });
	expect(await clients.get("gmail")).toEqual({ made: 2 });
});

test("a signed-in account whose address Google does not say shows why", async () => {
	await configure({ gmail: ORIGINAL });
	await signIn(URL_ID, UNREADABLE);
	const { integrations } = integrationsWith({});
	const { gmail } = (await integrations.load(false)).integrations;
	expect(gmail.accounts.map(({ name, address, addressError }) => ({ name, address, addressError }))).toEqual([{ name: "gmail", address: null, addressError: "Google answered 500" }]);
});

test("a Gmail and a Google Calendar account whose addresses differ only in case share one workspace link", async () => {
	await configure({ gmail: ORIGINAL, "google-calendar": { type: "http", url: CALENDAR, oauth: OAUTH } });
	const { integrations } = integrationsWith({});
	browser.push("Ana@Example.com", "ana@EXAMPLE.com");
	await integrations.startSignIn({ id: "gmail", account: null });
	await integrations.startSignIn({ id: "google-calendar", account: null });
	for (const { auth } of Object.values(config())) signedInIds.add(auth?.credentialId as string);
	const answer = await integrations.linkGoogleAccount({ address: "ANA@example.com", workspaces: ["/work"] });
	const linked = [...answer.integrations.gmail.accounts, ...answer.integrations["google-calendar"].accounts].map(({ name, address, workspaces }) => ({ name, address, workspaces }));
	expect(linked).toEqual([
		{ name: "gmail", address: "ana@example.com", workspaces: ["/work"] },
		{ name: "google-calendar", address: "ana@example.com", workspaces: ["/work"] },
	]);
});
