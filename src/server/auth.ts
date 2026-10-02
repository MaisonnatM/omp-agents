/** The dashboard's access token: where it lives, how a request proves it holds it, and which cross-site requests are refused. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The cookie that carries the token once the page has logged in. */
export const COOKIE = "omp-agents-token";
/** The cookie outlives the browser session; deleting the token file is how it is revoked. */
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** 32 random bytes as base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function readToken(file: string): string | null {
	try {
		const token = readFileSync(file, "utf8").trim();
		if (!TOKEN_SHAPE.test(token)) return null;
		// A token another account could read is no secret: tighten the file rather than trust it.
		if (statSync(file).mode & 0o077) chmodSync(file, 0o600);
		return token;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/**
 * The token in `file`, made first when the file is missing or does not hold one. The file is created with mode 0600
 * in a directory of mode 0700, so only the user can read it, and it survives restarts.
 */
export function loadToken(file: string): string {
	const existing = readToken(file);
	if (existing) return existing;
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	rmSync(file, { force: true });
	const token = randomBytes(32).toString("base64url");
	try {
		writeFileSync(file, `${token}\n`, { mode: 0o600, flag: "wx" });
	} catch (err) {
		// Another server started in the same moment and wrote its own; both must agree.
		const raced = (err as NodeJS.ErrnoException).code === "EEXIST" ? readToken(file) : null;
		if (!raced) throw err;
		return raced;
	}
	return token;
}

/** Whether `given` is the token. Both sides are hashed first, so the comparison takes the same time whatever `given` is. */
export function tokenMatches(token: string, given: string | null | undefined): boolean {
	if (!given) return false;
	const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
	return timingSafeEqual(digest(token), digest(given));
}

/** The value of cookie `name` in a `Cookie` header. */
export function cookieValue(header: string | null, name: string): string | null {
	for (const part of header?.split(";") ?? []) {
		const eq = part.indexOf("=");
		if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return null;
}

/** The `Set-Cookie` value that logs the browser in. `Strict` keeps every cross-site request from carrying it. */
export const loginCookie = (token: string): string => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`;

/**
 * Whether a request with this `Sec-Fetch-Site` may proceed. Browsers send the header; other clients do not, and
 * they hold the token or they do not get in. `none` is the address bar or a bookmark, which only the page itself may be.
 */
export const fetchSiteAllowed = (site: string | null, page: boolean): boolean => site === null || site === "same-origin" || (page && site === "none");
