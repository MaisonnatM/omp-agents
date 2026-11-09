/**
 * API credits balance from a signed-in Claude Console session.
 * omp's usage report has no balance for an API key, and an individual Console org cannot call the Admin cost API,
 * so this reads the `sessionKey` cookie Firefox and Zen store for platform.claude.com and the billing page's balance.
 */
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { isObject, num, str } from "./json";
import type { CreditBalance } from "./shared/models";

const CONSOLE = "https://platform.claude.com";
const SESSION_HOSTS = ["platform.claude.com", ".platform.claude.com"];

/** Profile roots whose `cookies.sqlite` stores the Console session in plaintext. Chrome's store is encrypted. */
export function cookieRootsFor(platform: string, home: string): string[] {
	if (platform === "darwin") {
		return [
			join(home, "Library/Application Support/zen/Profiles"),
			join(home, "Library/Application Support/Firefox/Profiles"),
			join(home, "Library/Application Support/LibreWolf/Profiles"),
			join(home, ".mozilla/firefox"),
		];
	}
	return [
		join(home, ".zen"),
		join(home, ".var/app/app.zen_browser.zen/.zen"),
		join(home, ".librewolf"),
		join(home, ".var/app/io.gitlab.librewolf-community/.librewolf"),
		join(home, ".mozilla/firefox"),
		join(home, "snap/firefox/common/.mozilla/firefox"),
		join(home, ".var/app/org.mozilla.firefox/.mozilla/firefox"),
	];
}

function cookieRoots(): string[] {
	return cookieRootsFor(process.platform, homedir());
}

/** `cookies.sqlite` files under the Firefox-family profile roots. */
export function consoleCookieDatabases(roots = cookieRoots()): string[] {
	const found: string[] = [];
	for (const root of roots) {
		let profiles: string[];
		try {
			profiles = readdirSync(root);
		} catch {
			continue;
		}
		for (const profile of profiles) {
			const db = join(root, profile, "cookies.sqlite");
			try {
				if (statSync(db).isFile()) found.push(db);
			} catch {
				// A profile with no cookie database is not signed in there.
			}
		}
	}
	return found;
}

interface SessionCookie {
	value: string;
	lastAccessed: number;
}

/** The newest platform.claude.com `sessionKey` in one cookie database, or null when it has none. */
export function sessionKeyIn(databasePath: string): SessionCookie | null {
	const dir = mkdtempSync(join(tmpdir(), "console-cookies-"));
	const copy = join(dir, "cookies.sqlite");
	try {
		copyFileSync(databasePath, copy);
		for (const suffix of ["-wal", "-shm"]) {
			try {
				copyFileSync(databasePath + suffix, copy + suffix);
			} catch {
				// The database has no write-ahead file.
			}
		}
		const db = new Database(copy, { readonly: true });
		try {
			const row = db
				.query(
					`SELECT value, lastAccessed AS lastAccessed FROM moz_cookies
					 WHERE name = 'sessionKey' AND host IN (${SESSION_HOSTS.map(() => "?").join(", ")})
					 ORDER BY lastAccessed DESC LIMIT 1`,
				)
				.get(...SESSION_HOSTS) as { value?: unknown; lastAccessed?: unknown } | null;
			const value = str(row?.value);
			const lastAccessed = num(row?.lastAccessed) ?? 0;
			if (!value || value.length > 512) return null;
			return { value, lastAccessed };
		} finally {
			db.close();
		}
	} catch {
		return null;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** The newest Console `sessionKey` across `databases`, or null when none is signed in. */
export function consoleSessionKey(databases = consoleCookieDatabases()): string | null {
	let best: SessionCookie | null = null;
	for (const database of databases) {
		const found = sessionKeyIn(database);
		if (found && (!best || found.lastAccessed > best.lastAccessed)) best = found;
	}
	return best?.value ?? null;
}

/** Uuids of organizations whose capabilities include `api`, in the order the Console listed them. */
export function apiOrganizationIds(body: unknown): string[] {
	const list = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.data) ? body.data : [];
	const ids: string[] = [];
	for (const org of list) {
		if (!isObject(org)) continue;
		const id = str(org.uuid);
		if (!id || !Array.isArray(org.capabilities) || !org.capabilities.includes("api")) continue;
		ids.push(id);
	}
	return ids;
}

function exponentOf(tranche: Record<string, unknown>): number {
	for (const side of ["remaining", "granted"]) {
		const block = tranche[side];
		if (!isObject(block) || !isObject(block.credits)) continue;
		const exponent = num(block.credits.exponent);
		if (exponent !== undefined && Number.isInteger(exponent) && exponent >= 0 && exponent <= 8) return exponent;
	}
	return 2;
}

/**
 * The promotional grant, dollars spent of it, when the Console reports one; otherwise the prepaid dollars left.
 * Each tranche's minor units use that tranche's exponent, defaulting to cents, and are read as US dollars, the currency
 * the Console bills API credits in; the expiry is the soonest tranche's.
 * The prepaid `amount` is in US cents, as the billing fields named `_cents` beside it are, and drops below zero when usage ran past it.
 */
export function creditBalanceOf(body: unknown): CreditBalance | null {
	if (!isObject(body)) return null;
	let used = 0;
	let granted = 0;
	let tranches = 0;
	let expiresAt: number | null = null;
	for (const raw of Array.isArray(body.promo_tranches) ? body.promo_tranches : []) {
		if (!isObject(raw)) continue;
		const grantMinor = num(raw.granted_amount_minor_units);
		const leftMinor = num(raw.remaining_amount_minor_units);
		if (grantMinor === undefined || leftMinor === undefined || grantMinor <= 0) continue;
		const scale = 10 ** exponentOf(raw);
		granted += grantMinor / scale;
		used += Math.max(0, grantMinor - leftMinor) / scale;
		const at = Date.parse(str(raw.expires_at) ?? "");
		if (!Number.isNaN(at)) expiresAt = expiresAt === null ? at : Math.min(expiresAt, at);
		tranches += 1;
	}
	if (tranches > 0 && granted > 0) return { kind: "grant", used, limit: granted, expiresAt };
	const cents = num(body.amount);
	return body.currency === "USD" && cents !== undefined ? { kind: "prepaid", left: cents / 100 } : null;
}

/** Enough of `fetch` for the Console calls. Tests pass a stand-in; `fetch` itself also has `preconnect`. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function getJson(url: string, sessionKey: string, fetchImpl: FetchLike): Promise<unknown> {
	try {
		const response = await fetchImpl(url, {
			headers: { accept: "application/json", cookie: `sessionKey=${sessionKey}`, "user-agent": "Mozilla/5.0" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	}
}

/** The first API organization's grant this session can read, else the first one's prepaid balance, or null when the session reads neither. */
export async function fetchConsoleCreditBalance(sessionKey: string, fetchImpl: FetchLike = fetch): Promise<CreditBalance | null> {
	const orgs = await getJson(`${CONSOLE}/api/organizations`, sessionKey, fetchImpl);
	let prepaid: CreditBalance | null = null;
	for (const id of apiOrganizationIds(orgs)) {
		const body = await getJson(`${CONSOLE}/api/organizations/${encodeURIComponent(id)}/prepaid/credits`, sessionKey, fetchImpl);
		const balance = creditBalanceOf(body);
		if (balance?.kind === "grant") return balance;
		prepaid ??= balance;
	}
	return prepaid;
}

/** The balance from the newest Firefox or Zen Console session, or null when there is none or the Console refuses it. */
export async function readConsoleCreditBalance(fetchImpl: FetchLike = fetch): Promise<CreditBalance | null> {
	const sessionKey = consoleSessionKey();
	if (!sessionKey) return null;
	return fetchConsoleCreditBalance(sessionKey, fetchImpl);
}
