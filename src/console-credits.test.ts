import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { apiOrganizationIds, consoleSessionKey, cookieRootsFor, creditBalanceOf, fetchConsoleCreditBalance, sessionKeyIn } from "./console-credits";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cookieDatabase(rows: { host: string; name: string; value: string; lastAccessed: number }[]): string {
	const dir = mkdtempSync(join(tmpdir(), "console-cookies-test-"));
	dirs.push(dir);
	const path = join(dir, "cookies.sqlite");
	const db = new Database(path);
	db.run("CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, lastAccessed INTEGER)");
	const insert = db.query("INSERT INTO moz_cookies (host, name, value, lastAccessed) VALUES (?, ?, ?, ?)");
	for (const row of rows) insert.run(row.host, row.name, row.value, row.lastAccessed);
	db.close();
	return path;
}

const tranche = (granted: number, remaining: number, expires: string, exponent = 2) => ({
	granted_amount_minor_units: granted,
	remaining_amount_minor_units: remaining,
	expires_at: expires,
	remaining: { credits: { amount_minor: remaining, exponent } },
});

describe("creditBalanceOf", () => {
	test("spent is the grant minus what is left, in the tranche's units", () => {
		const balance = creditBalanceOf({
			promo_tranches: [tranche(20_000, 18_887, "2026-12-03T00:00:00Z")],
			amount: 18_887,
			currency: "USD",
		});
		expect(balance).toEqual({ kind: "grant", used: 11.13, limit: 200, expiresAt: Date.parse("2026-12-03T00:00:00Z") });
	});

	test("sums tranches and keeps the soonest expiry", () => {
		const balance = creditBalanceOf({
			promo_tranches: [tranche(10_000, 4_000, "2026-12-03T00:00:00Z"), tranche(5_000, 5_000, "2026-11-20T00:00:00Z")],
		});
		expect(balance).toEqual({ kind: "grant", used: 60, limit: 150, expiresAt: Date.parse("2026-11-20T00:00:00Z") });
	});

	test("with no grant, the prepaid cents left, below zero when usage ran past them", () => {
		expect(creditBalanceOf({ promo_tranches: [], amount: -72, currency: "USD" })).toEqual({ kind: "prepaid", left: -0.72 });
		expect(creditBalanceOf({ amount: -72, currency: "USD" })).toEqual({ kind: "prepaid", left: -0.72 });
		expect(creditBalanceOf({ promo_tranches: [], amount: 500, currency: "USD" })).toEqual({ kind: "prepaid", left: 5 });
	});

	test("no grant and no dollar amount is no balance", () => {
		expect(creditBalanceOf({ promo_tranches: [], amount: 500, currency: "EUR" })).toBeNull();
		expect(creditBalanceOf({ promo_tranches: [] })).toBeNull();
		expect(creditBalanceOf(null)).toBeNull();
	});
});

describe("apiOrganizationIds", () => {
	test("keeps organizations that can call the API, in listed order", () => {
		expect(
			apiOrganizationIds([
				{ uuid: "chat", capabilities: ["chat", "claude_max"] },
				{ uuid: "api-org", capabilities: ["api", "api_individual"] },
			]),
		).toEqual(["api-org"]);
	});
});

describe("cookieRootsFor", () => {
	test("Linux looks in the home-directory layouts Zen, LibreWolf, and Firefox use", () => {
		expect(cookieRootsFor("linux", "/home/dev")).toEqual([
			"/home/dev/.zen",
			"/home/dev/.var/app/app.zen_browser.zen/.zen",
			"/home/dev/.librewolf",
			"/home/dev/.var/app/io.gitlab.librewolf-community/.librewolf",
			"/home/dev/.mozilla/firefox",
			"/home/dev/snap/firefox/common/.mozilla/firefox",
			"/home/dev/.var/app/org.mozilla.firefox/.mozilla/firefox",
		]);
	});
});

describe("sessionKeyIn", () => {
	test("the newest platform.claude.com sessionKey, not a claude.ai one", () => {
		const path = cookieDatabase([
			{ host: ".platform.claude.com", name: "sessionKey", value: "older", lastAccessed: 1 },
			{ host: "platform.claude.com", name: "sessionKey", value: "newer", lastAccessed: 5 },
			{ host: "claude.ai", name: "sessionKey", value: "other", lastAccessed: 9 },
		]);
		expect(sessionKeyIn(path)).toEqual({ value: "newer", lastAccessed: 5 });
		expect(consoleSessionKey([path])).toBe("newer");
	});
});

describe("fetchConsoleCreditBalance", () => {
	test("asks the API organization and skips one that is not", async () => {
		const calls: string[] = [];
		const fetchImpl = async (input: string, init?: RequestInit) => {
			const url = String(input);
			calls.push(url);
			expect(new Headers(init?.headers).get("cookie")).toBe("sessionKey=secret");
			if (url.endsWith("/api/organizations")) {
				return Response.json([
					{ uuid: "chat", capabilities: ["chat"] },
					{ uuid: "api-org", capabilities: ["api"] },
				]);
			}
			return Response.json({ promo_tranches: [tranche(20_000, 18_887, "2026-12-03T00:00:00Z")] });
		};
		const balance = await fetchConsoleCreditBalance("secret", fetchImpl);
		expect(calls.some(url => url.includes("/chat/"))).toBe(false);
		expect(calls.some(url => url.endsWith("/api-org/prepaid/credits"))).toBe(true);
		expect(balance).toMatchObject({ kind: "grant", limit: 200 });
	});

	test("a grant on a later organization beats a prepaid balance on the first", async () => {
		const fetchImpl = async (input: string) => {
			const url = String(input);
			if (url.endsWith("/api/organizations")) return Response.json([{ uuid: "prepaid-org", capabilities: ["api"] }, { uuid: "grant-org", capabilities: ["api"] }]);
			if (url.includes("/prepaid-org/")) return Response.json({ promo_tranches: [], amount: 500, currency: "USD" });
			return Response.json({ promo_tranches: [tranche(20_000, 18_887, "2026-12-03T00:00:00Z")] });
		};
		expect(await fetchConsoleCreditBalance("secret", fetchImpl)).toMatchObject({ kind: "grant", limit: 200 });
	});

	test("with no grant anywhere, the first organization's prepaid balance", async () => {
		const fetchImpl = async (input: string) => {
			const url = String(input);
			if (url.endsWith("/api/organizations")) return Response.json([{ uuid: "first", capabilities: ["api"] }, { uuid: "second", capabilities: ["api"] }]);
			return Response.json({ promo_tranches: [], amount: url.includes("/first/") ? -72 : 500, currency: "USD" });
		};
		expect(await fetchConsoleCreditBalance("secret", fetchImpl)).toEqual({ kind: "prepaid", left: -0.72 });
	});
});
