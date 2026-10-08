import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClientSave, googleSetupFrom, planGoogleSave, planSlackSave, slackSetupFrom } from "./mcp-clients";
import { writeMcpServer } from "./omp/mcp";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const configPath = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-slack-"));
	dirs.push(dir);
	return join(dir, "mcp.json");
};

const app = {
	clientId: "111.222",
	clientSecret: "app-secret",
	redirectUri: "https://omp.example/slack",
	callbackPort: 8787,
	scope: "chat:write channels:history",
};

async function save(path: string, input: typeof app | Omit<typeof app, "clientSecret">): Promise<ClientSave> {
	const planned = await planSlackSave(path, input);
	await writeMcpServer(path, planned.name, planned.server);
	return planned;
}

test("incomplete or unsupported stored Slack app settings stay unconfigured", () => {
	expect(slackSetupFrom({
		oauth: { clientId: "111.222", clientSecret: "app-secret", redirectUri: "http://127.0.0.1:3000/callback", callbackPort: 3000, scope: "files:read" },
	})).toEqual({
		clientId: "111.222",
		hasClientSecret: true,
		redirectUri: "http://127.0.0.1:3000/callback",
		callbackPort: 3000,
		scope: "files:read",
		configured: false,
	});
});

test("a saved Slack app keeps unrelated MCP config, hides the secret, and preserves it when the client ID stays", async () => {
	const path = configPath();
	writeFileSync(path, JSON.stringify({
		disabledServers: ["other"],
		mcpServers: {
			other: { type: "http", url: "https://example.com/mcp" },
			"team-slack": {
				type: "http",
				url: "https://mcp.slack.com/mcp",
				timeout: 120000,
				instructions: false,
				headers: { "X-Test": "keep" },
				oauth: { ...app, callbackPath: "/slack/callback", prompt: "consent" },
				auth: { type: "oauth", credentialId: "kept-id", clientId: app.clientId, clientSecret: app.clientSecret },
			},
		},
	}));
	const kept = await save(path, { clientId: app.clientId, redirectUri: app.redirectUri, callbackPort: app.callbackPort, scope: "users:read" });
	expect(kept.dropCredentials).toBe(false);
	expect(slackSetupFrom(kept.server)).not.toHaveProperty("clientSecret");
	expect(JSON.parse(readFileSync(path, "utf8")).mcpServers["team-slack"].oauth.clientSecret).toBe("app-secret");
	const changed = await save(path, { ...app, clientSecret: "replacement-secret", scope: "users:read" });
	expect(changed.dropCredentials).toBe(true);
	expect(changed.credential).toEqual({ name: "team-slack", url: "https://mcp.slack.com/mcp", credentialId: "kept-id" });
	expect(slackSetupFrom(changed.server)).not.toHaveProperty("clientSecret");
	const file = JSON.parse(readFileSync(path, "utf8"));
	expect(file.disabledServers).toEqual(["other"]);
	expect(file.mcpServers.other).toEqual({ type: "http", url: "https://example.com/mcp" });
	expect(file.mcpServers.slack).toBeUndefined();
	expect(file.mcpServers["team-slack"]).toMatchObject({
		timeout: 120000,
		instructions: false,
		headers: { "X-Test": "keep" },
		oauth: { clientId: "111.222", clientSecret: "replacement-secret", scope: "users:read", redirectUri: "https://omp.example/slack", callbackPort: 8787, callbackPath: "/slack/callback", prompt: "consent" },
		auth: { type: "oauth", credentialId: "kept-id", clientId: "111.222", clientSecret: "replacement-secret" },
	});
	expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("changing the Slack client ID without a new secret does not write, and a different server named slack is left alone", async () => {
	const path = configPath();
	const seeded = JSON.stringify({ mcpServers: { slack: { type: "http", url: "https://example.com/mcp", oauth: { clientId: "old", clientSecret: "old-secret" } } } });
	writeFileSync(path, seeded);
	await expect(planSlackSave(path, { ...app, clientId: "999.999", clientSecret: undefined })).rejects.toThrow("different address");
	expect(readFileSync(path, "utf8")).toBe(seeded);
	const ready = configPath();
	await save(ready, app);
	const before = readFileSync(ready, "utf8");
	await expect(planSlackSave(ready, { clientId: "999.999", redirectUri: app.redirectUri, callbackPort: app.callbackPort, scope: app.scope })).rejects.toThrow(
		"Changing the Slack client ID needs the new app's client secret.",
	);
	expect(readFileSync(ready, "utf8")).toBe(before);
});

test("a Google client save asks for consent and the calendar scopes, redirects to its callback port, and keeps the secret only for the same client", async () => {
	const path = configPath();
	writeFileSync(path, JSON.stringify({ mcpServers: { calendar: { type: "http", url: "https://calendarmcp.googleapis.com/mcp/v1", auth: { type: "oauth", credentialId: "cal-id" } } } }));
	const first = await planGoogleSave(path, { clientId: "1-a.apps.googleusercontent.com", clientSecret: "first-secret", callbackPort: 3119 });
	await writeMcpServer(path, first.name, first.server);
	expect(first.name).toBe("calendar");
	expect(JSON.parse(readFileSync(path, "utf8")).mcpServers.calendar.oauth).toEqual({
		clientId: "1-a.apps.googleusercontent.com",
		clientSecret: "first-secret",
		scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy",
		prompt: "consent",
		redirectUri: "http://localhost:3119/callback",
		callbackPort: 3119,
	});
	expect(googleSetupFrom(first.server)).toEqual({ clientId: "1-a.apps.googleusercontent.com", hasClientSecret: true, callbackPort: 3119, configured: true });

	const moved = await planGoogleSave(path, { clientId: "1-a.apps.googleusercontent.com", callbackPort: 3120 });
	expect(moved.dropCredentials).toBe(false);
	expect(moved.server.oauth).toMatchObject({ clientSecret: "first-secret", redirectUri: "http://localhost:3120/callback", callbackPort: 3120 });
	await expect(planGoogleSave(path, { clientId: "2-b.apps.googleusercontent.com", callbackPort: 3119 })).rejects.toThrow("needs the new app's client secret");
	const replaced = await planGoogleSave(path, { clientId: "2-b.apps.googleusercontent.com", clientSecret: "second-secret", callbackPort: 3119 });
	expect(replaced.dropCredentials).toBe(true);
	expect(replaced.credential).toEqual({ name: "calendar", url: "https://calendarmcp.googleapis.com/mcp/v1", credentialId: "cal-id" });
});

test("a Google client without a saved callback port is not set up, since omp would listen on another port", () => {
	expect(googleSetupFrom({ oauth: { clientId: "1-a.apps.googleusercontent.com", clientSecret: "s" } })).toEqual({
		clientId: "1-a.apps.googleusercontent.com",
		hasClientSecret: true,
		callbackPort: 3119,
		configured: false,
	});
});
