import { expect, test } from "bun:test";
import { MCP_INTEGRATIONS, MCP_SERVICES } from "./accounts";

test("only Slack's sign-in requires a refresh token", () => {
	expect(MCP_INTEGRATIONS.filter(id => MCP_SERVICES[id].requireRefresh)).toEqual(["slack"]);
});
