/** The dashboard's access token: where it lives, how a request proves it holds it, and which cross-site requests are refused. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MEDIA_KEY_STORAGE_KEY, TOKEN_STORAGE_KEY } from "../shared/access";

/** 32 random bytes as base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function readToken(file: string): string | null {
	try {
		const token = readFileSync(file, "utf8").trim();
		if (!TOKEN_SHAPE.test(token)) return null;
		// A token another account could read may already be known: replace it rather than tighten the file and trust it.
		if (statSync(file).mode & 0o077) return null;
		return token;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/**
 * The token in `file`, made first when the file is missing, does not hold one, or other accounts could read it. The
 * file is created with mode 0600 in a directory of mode 0700, so only the user can read it, and it survives restarts.
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

/** Whether `given` is `secret`. Both sides are hashed first, so the comparison takes the same time whatever `given` is. */
export function tokenMatches(secret: string, given: string | null | undefined): boolean {
	if (!given) return false;
	const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
	return timingSafeEqual(digest(secret), digest(given));
}

/** The token an `Authorization: Bearer <token>` header carries. */
export function bearerToken(header: string | null): string | null {
	const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
	return match?.[1] ?? null;
}

const keyed = (token: string, purpose: string): string => createHmac("sha256", token).update(purpose).digest("base64url");

/**
 * The key that an image, a video, or a mail frame sends as `?key=`, since a tag sends no header. It opens only the
 * routes that such tags load, and the token cannot be worked back from it.
 */
export const mediaKey = (token: string): string => keyed(token, "omp-agents media key");

/** The localStorage entries that sign the page in: the desktop window's preload writes them, as does a script that drives the page. */
export const pageAccess = (token: string): Record<string, string> => ({ [TOKEN_STORAGE_KEY]: token, [MEDIA_KEY_STORAGE_KEY]: mediaKey(token) });

/**
 * What `GET /api/hello?nonce=` answers: proof that the server on `port` holds `token`, which tells nothing about the
 * token. The desktop shell checks it before it sends the token to whatever answers on the port. The port is part of
 * it, so a program on another port cannot pass on a real server's answer as its own.
 */
export const helloProof = (token: string, port: number, nonce: string): string => keyed(token, `omp-agents hello ${port} ${nonce}`);

/**
 * Whether a request with this `Sec-Fetch-Site` may proceed. Browsers send the header; other clients do not, and
 * they hold the token or they do not get in. `none` is the address bar or a bookmark, which only the page itself may be.
 */
export const fetchSiteAllowed = (site: string | null, page: boolean): boolean => site === null || site === "same-origin" || (page && site === "none");
