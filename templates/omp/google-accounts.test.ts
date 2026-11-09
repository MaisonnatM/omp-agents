import { describe, expect, test } from "bun:test";
import { join } from "node:path";

interface Account {
	server: string;
	address: string | null;
}
interface ServiceAccounts {
	label: string;
	accounts: Account[];
}

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	servicesOf(mcp: object, accounts: { addresses: Record<string, string> }): ServiceAccounts[];
	accountsText(services: readonly ServiceAccounts[]): string | null;
} = await import(join(import.meta.dir, "agent/extensions/google-accounts.ts"));
const { accountsText, servicesOf } = extension;

const GMAIL = "https://gmailmcp.googleapis.com/mcp/v1";
const CALENDAR = "https://calendarmcp.googleapis.com/mcp/v1";

describe("google-accounts extension", () => {
	test("each Google service's accounts are its enabled servers on its host, with their learned addresses", () => {
		const services = servicesOf(
			{
				disabledServers: ["gmail-3"],
				mcpServers: {
					gmail: { type: "http", url: GMAIL },
					linear: { type: "http", url: "https://mcp.linear.app/mcp" },
					"Gmail Work": { type: "http", url: GMAIL },
					"gmail-3": { type: "http", url: GMAIL },
					"gmail-4": { type: "http", url: GMAIL, enabled: false },
					"google-calendar": { type: "http", url: CALENDAR },
				},
			},
			{ addresses: { gmail: "ana@example.com", "google-calendar": "ana@example.com" } },
		);
		expect(services).toEqual([
			{
				label: "Gmail",
				accounts: [
					{ server: "gmail", address: "ana@example.com" },
					{ server: "Gmail Work", address: null },
				],
			},
			{ label: "Google Calendar", accounts: [{ server: "google-calendar", address: "ana@example.com" }] },
		]);
	});

	test("one account per service tells nothing", () => {
		expect(
			accountsText([
				{ label: "Gmail", accounts: [{ server: "gmail", address: "ana@example.com" }] },
				{ label: "Google Calendar", accounts: [{ server: "google-calendar", address: "ana@example.com" }] },
			]),
		).toBeNull();
	});

	test("two accounts on a service list that service's accounts and their tool prefixes", () => {
		expect(
			accountsText([
				{
					label: "Gmail",
					accounts: [
						{ server: "gmail", address: "ana@example.com" },
						{ server: "gmail-2", address: "ana@work.example" },
						{ server: "Gmail Work", address: null },
					],
				},
				{ label: "Google Calendar", accounts: [{ server: "google-calendar", address: "ana@example.com" }] },
			]),
		).toBe(
			[
				"omp is signed in to several Google accounts, one MCP server each, and each server's tools start with its prefix.",
				"Gmail:",
				"- gmail: ana@example.com, tools `mcp__gmail_`",
				"- gmail-2: ana@work.example, tools `mcp__gmail_2_`",
				"- Gmail Work: address not known yet, tools `mcp__gmail_work_`",
			].join("\n"),
		);
	});
});
