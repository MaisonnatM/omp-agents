import { expect, test } from "bun:test";
import { GOOGLE_SERVICES, googleMcpEnableUrl, MCP_INTEGRATIONS, MCP_SERVICES } from "./accounts";

test("Google's enable page names the MCP server's API and the project number the OAuth client ID starts with", () => {
	expect(googleMcpEnableUrl("calendarmcp.googleapis.com", "30887206948-fot6diel47j76ceoft65e8sjojbstop1.apps.googleusercontent.com")).toBe(
		"https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948",
	);
	expect(googleMcpEnableUrl("gmailmcp.googleapis.com", "12-a.apps.googleusercontent.com")).toBe("https://console.developers.google.com/apis/api/gmailmcp.googleapis.com/overview?project=12");
});

test("a client ID that does not start with a project number has no enable page", () => {
	expect(googleMcpEnableUrl("gmailmcp.googleapis.com", "custom-client.apps.googleusercontent.com")).toBeNull();
});

test("the Google services are the ones with a Google OAuth client, and only Slack's sign-in requires a refresh token", () => {
	expect(GOOGLE_SERVICES).toEqual(["google-calendar", "gmail"]);
	expect(MCP_INTEGRATIONS.filter(id => MCP_SERVICES[id].requireRefresh)).toEqual(["slack"]);
});
