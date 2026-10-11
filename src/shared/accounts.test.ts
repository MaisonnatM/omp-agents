import { expect, test } from "bun:test";
import { googleMcpEnableUrl } from "./accounts";

test("Google's enable page names the MCP server's API and the project number the OAuth client ID starts with", () => {
	expect(googleMcpEnableUrl("calendarmcp.googleapis.com", "30887206948-fot6diel47j76ceoft65e8sjojbstop1.apps.googleusercontent.com")).toBe(
		"https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948",
	);
	expect(googleMcpEnableUrl("gmailmcp.googleapis.com", "12-a.apps.googleusercontent.com")).toBe("https://console.developers.google.com/apis/api/gmailmcp.googleapis.com/overview?project=12");
});

test("a client ID that does not start with a project number has no enable page", () => {
	expect(googleMcpEnableUrl("gmailmcp.googleapis.com", "custom-client.apps.googleusercontent.com")).toBeNull();
});
