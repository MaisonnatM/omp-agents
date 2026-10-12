import { describe, expect, test } from "bun:test";
import { MCP_INTEGRATIONS, MCP_SERVICES } from "./accounts";
import { catalogEntryOn, MCP_CATALOG } from "./mcp-catalog";

const hostOf = (url: string): string => new URL(url).host;

describe("MCP_CATALOG", () => {
	test("each entry adds under a distinct name omp accepts, at an https address no other entry or integration claims", () => {
		const ids = MCP_CATALOG.map(entry => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const entry of MCP_CATALOG) {
			expect(entry.id).toMatch(/^[a-z0-9-]+$/);
			expect(new URL(entry.url).protocol).toBe("https:");
			expect(catalogEntryOn(hostOf(entry.url))?.id).toBe(entry.id);
		}
		for (const id of MCP_INTEGRATIONS) expect(catalogEntryOn(MCP_SERVICES[id].host)).toBeNull();
	});

	test("a server on a vendor's other region counts as its entry, and an unknown host as none", () => {
		expect(catalogEntryOn("mcp.datadoghq.eu")?.id).toBe("datadog");
		expect(catalogEntryOn("mcp.example.com")).toBeNull();
		expect(catalogEntryOn(null)).toBeNull();
	});
});
