/** What every HTTP route shares: refusals, answers, and the checks that keep other sites and programs' pages out. */
import { errorText } from "../json";
import { MEDIA_KEY_PARAM, SOCKET_PROTOCOL, SOCKET_TOKEN_PREFIX } from "../shared/access";
import type { SettingsError } from "../shared/models";
import { dashboardHosts } from "./address";
import { bearerToken, fetchSiteAllowed, helloProof, mediaKey, tokenMatches } from "./auth";

export const fail = (status: number, error: string, conflict = false): Response =>
	Response.json({ error, ...(conflict && { conflict: true }) } satisfies SettingsError, { status });

/** The JSON of `run`'s result; when it throws, `refuse`'s response for the error, else a 500 with its text. */
export async function answer(run: () => Promise<unknown>, refuse?: (err: unknown) => Response | null): Promise<Response> {
	try {
		return Response.json(await run());
	} catch (err) {
		return refuse?.(err) ?? fail(500, errorText(err));
	}
}

/**
 * Refuses with a 503 until `settled` settles, then lets everything through. The dashboard socket waits so on the
 * sessions the last server left running: a page that connects sooner retries, as it does after any failed connect.
 */
export function refuseUntil(settled: Promise<unknown>, why: string): () => Response | null {
	let open = false;
	void settled.then(() => {
		open = true;
	});
	return () => (open ? null : fail(503, why));
}

const NOT_SIGNED_IN = "Not signed in: open the URL that the server printed, or send Authorization: Bearer <token>";

export interface Guards {
	/** Whether the request names a host this server answers to. DNS rebinding cannot pass it. */
	allowedHost(req: Request): boolean;
	/** Whether the request's `?token=` is the token: the printed URL, which signs a browser in. */
	login(req: Request): boolean;
	/**
	 * The response refusing an API request, or `null` to answer it: the Host check, then `Sec-Fetch-Site` (403), then
	 * the `Authorization: Bearer` header (401). A `?token=` is no credential here.
	 */
	admit(req: Request): Response | null;
	/** `admit` that also takes the media key as `?key=`, for the routes that an image, a video, or a mail frame loads. */
	admitMedia(req: Request): Response | null;
	/**
	 * `admit` for the socket upgrade, which carries full control of every session: an Origin that matches the Host,
	 * and the token as a header or, since a browser's socket can send none, as the subprotocol `bearer.<token>`.
	 */
	admitSocket(req: Request): Response | null;
	/**
	 * The headers that accept a socket that `admitSocket` admitted. Offered any subprotocol, it answers with its own,
	 * since Bun would otherwise pick the first offered, which may be the token.
	 */
	socketHeaders(req: Request): Record<string, string>;
	/** A write's JSON body, or the response refusing it. Only this app's own page may write, and only with a JSON body, which a cross-site form cannot send. */
	writeBody(req: Request): Promise<{ body: unknown } | Response>;
	/** The answer to `GET /api/hello?nonce=`, which needs no token: {@link helloProof} for the nonce. */
	hello(req: Request): Response;
}

/**
 * Only the page this app served on `port`, signed in with `token`, may open the socket or read omp's files.
 * DNS rebinding cannot pass the Host check, and a cross-site page cannot pass the `Sec-Fetch-Site` or Origin checks.
 * No request carries the token by itself: the page sends it from its own localStorage, which no other port can read.
 * A local program must hold the token, which only the user can read.
 */
export function guardsFor(port: number, token: string): Guards {
	const hosts = new Set(dashboardHosts(port));
	const media = mediaKey(token);
	const allowedHost = (req: Request): boolean => hosts.has(req.headers.get("host") ?? "");
	const sameOrigin = (req: Request): boolean => allowedHost(req) && req.headers.get("origin") === `http://${req.headers.get("host")}`;
	const outside = (req: Request): Response | null => {
		if (!allowedHost(req)) return fail(403, "forbidden host");
		if (!fetchSiteAllowed(req.headers.get("sec-fetch-site"), false)) return fail(403, "forbidden origin");
		return null;
	};
	const bearer = (req: Request): boolean => tokenMatches(token, bearerToken(req.headers.get("authorization")));
	const admit = (req: Request): Response | null => outside(req) ?? (bearer(req) ? null : fail(401, NOT_SIGNED_IN));
	return {
		allowedHost,
		login: req => tokenMatches(token, new URL(req.url).searchParams.get("token")),
		admit,
		admitMedia: req => outside(req) ?? (bearer(req) || tokenMatches(media, new URL(req.url).searchParams.get(MEDIA_KEY_PARAM)) ? null : fail(401, NOT_SIGNED_IN)),
		admitSocket(req) {
			const refused = outside(req);
			if (refused) return refused;
			if (!sameOrigin(req)) return fail(403, "forbidden origin");
			const offered = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map(protocol => protocol.trim());
			const subprotocol = offered.find(protocol => protocol.startsWith(SOCKET_TOKEN_PREFIX))?.slice(SOCKET_TOKEN_PREFIX.length);
			return bearer(req) || tokenMatches(token, subprotocol) ? null : fail(401, NOT_SIGNED_IN);
		},
		socketHeaders: (req): Record<string, string> => (req.headers.has("sec-websocket-protocol") ? { "sec-websocket-protocol": SOCKET_PROTOCOL } : {}),
		async writeBody(req) {
			const refused = admit(req);
			if (refused) return refused;
			if (!sameOrigin(req)) return fail(403, "forbidden origin");
			if (req.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
				return fail(415, "Expected a JSON body");
			}
			try {
				return { body: await req.json() };
			} catch {
				return fail(400, "The body is not valid JSON");
			}
		},
		hello(req) {
			const refused = outside(req);
			if (refused) return refused;
			const nonce = new URL(req.url).searchParams.get("nonce") ?? "";
			if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return fail(400, "Expected ?nonce= of 16 to 128 base64url characters");
			return Response.json({ proof: helloProof(token, port, nonce) }, { headers: { "cache-control": "no-store" } });
		},
	};
}
