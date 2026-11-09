/** What every HTTP route shares: refusals, answers, and the checks that keep other sites and programs' pages out. */
import { errorText, type Parsed } from "../json";
import { MEDIA_KEY_PARAM, SOCKET_PROTOCOL, SOCKET_TOKEN_PREFIX } from "../shared/access";
import type { SettingsError } from "../shared/models";
import { dashboardHosts } from "./address";
import { bearerToken, fetchSiteAllowed, helloProof, mediaKey, tokenMatches } from "./auth";
import type { PhoneAccess } from "./phone-access";

export const fail = (status: number, error: string, conflict = false): Response =>
	Response.json({ error, ...(conflict && { conflict: true }) } satisfies SettingsError, { status });

/** The JSON of `run`'s result, or the result itself when it is a `Response`; when it throws, `refuse`'s response for the error, else a 500 with its text. */
export async function answer(run: () => Promise<unknown>, refuse?: (err: unknown) => Response | null): Promise<Response> {
	try {
		const result = await run();
		return result instanceof Response ? result : Response.json(result);
	} catch (err) {
		return refuse?.(err) ?? fail(500, errorText(err));
	}
}

/**
 * Runs `run`, which calls `step` as each of its steps starts. Until the first, it answers as {@link answer} does, so a
 * refusal keeps its status; from then on the answer is NDJSON: a `{ step }` line for each, then one `{ done }` line with
 * `run`'s result or `{ error }` with why it failed, so the outcome never arrives before its last step.
 */
export async function answerSteps<S, T>(run: (step: (step: S) => void) => Promise<T>, refuse: (err: unknown) => Response): Promise<Response> {
	const { readable, writable } = new TextEncoderStream();
	const writer = writable.getWriter();
	// A page that went away cancels the stream, which rejects each write after; the work goes on without it.
	const send = (line: { step: S } | { done: T } | { error: string }): void => void writer.write(`${JSON.stringify(line)}\n`).catch(() => {});
	const stepped = Promise.withResolvers<null>();
	const ended = run(step => {
		send({ step });
		stepped.resolve(null);
	}).then(
		done => ({ done }),
		(err: unknown) => ({ err }),
	);
	const first = await Promise.race([stepped.promise, ended]);
	if (first && "err" in first) return refuse(first.err);
	void ended.then(end => {
		send("done" in end ? { done: end.done } : { error: errorText(end.err) });
		writer.close().catch(() => {});
	});
	return new Response(readable, { headers: { "content-type": "application/x-ndjson" } });
}

/** The value `parsed` holds, or a 400 with the parser's own reason, else with `badRequest`. */
export function checked<T>(parsed: Parsed<T>, badRequest: string): T | Response;
export function checked<T>(parsed: Parsed<T, { error: string }>): T | Response;
export function checked<T>(parsed: Parsed<T, { error: string } | null>, badRequest = ""): T | Response {
	if (parsed && "ok" in parsed) return parsed.ok;
	return fail(400, parsed ? parsed.error : badRequest);
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

const NOT_SIGNED_IN = "Not signed in: send Authorization: Bearer <token>, with the token from the server's token file";

export interface Guards {
	/** Whether the request names a host this server answers to. DNS rebinding cannot pass it. */
	allowedHost(req: Request): boolean;
	/**
	 * The response refusing an API request, or `null` to answer it: the Host check, then `Sec-Fetch-Site` (403), then
	 * the `Authorization: Bearer` header (401). A token in the query is no credential.
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
	 * since Bun would otherwise pick the first offered, which may be the token. Offered none, it gives no headers:
	 * Bun's `upgrade` throws on an empty object, which would answer a client signed in by header with a 500.
	 */
	socketHeaders(req: Request): Record<string, string> | undefined;
	/**
	 * `writeBody` that only the desktop window may call: the main token, on a loopback host. A paired phone's token,
	 * which reaches every other route, is refused here.
	 */
	writeBodyLocal(req: Request): Promise<{ body: unknown } | Response>;
	/** A write's JSON body, or the response refusing it. Only this app's own page may write, and only with a JSON body, which a cross-site form cannot send. */
	writeBody(req: Request): Promise<{ body: unknown } | Response>;
	/** Who signed this request in: the desktop window, a paired phone, or nobody. */
	signer(req: Request): { kind: "main" } | { kind: "phone"; id: string } | null;
	/** The answer to `GET /api/hello?nonce=`, which needs no token: {@link helloProof} for the nonce. */
	hello(req: Request): Response;
}

/** What a request proves, once its host is this server's: the desktop window's token, or a paired phone's. */
interface Presented {
	kind: "main" | "phone";
	phoneId: string | null;
	/** The token as presented, so a phone's last connection can be noted. */
	token: string | null;
}

/**
 * Only the page this app served, signed in with `token` or, while Phone access is on, with a paired phone's own token
 * at the tailnet address, may open the socket or read omp's files. `phones` absent admits nobody but the desktop window.
 */
export function guardsFor(port: number, token: string, phones?: PhoneAccess): Guards {
	const loopback = new Set(dashboardHosts(port));
	const media = mediaKey(token);
	const hostOf = (req: Request): string => req.headers.get("host") ?? "";
	const tailnet = (req: Request): boolean => phones?.tailnetHost() === hostOf(req).split(":")[0];
	const allowedHost = (req: Request): boolean => loopback.has(hostOf(req)) || tailnet(req);
	const originOf = (req: Request): string => (tailnet(req) ? "https" : "http") + `://${hostOf(req)}`;
	const sameOrigin = (req: Request): boolean => allowedHost(req) && req.headers.get("origin") === originOf(req);
	const outside = (req: Request): Response | null => {
		if (!allowedHost(req)) return fail(403, "forbidden host");
		if (!fetchSiteAllowed(req.headers.get("sec-fetch-site"), false)) return fail(403, "forbidden origin");
		return null;
	};
	/** The token a browser's socket offers as the `bearer.<token>` subprotocol, since it can send no header. */
	const socketToken = (req: Request): string | undefined =>
		(req.headers.get("sec-websocket-protocol") ?? "")
			.split(",")
			.map(protocol => protocol.trim())
			.find(protocol => protocol.startsWith(SOCKET_TOKEN_PREFIX))
			?.slice(SOCKET_TOKEN_PREFIX.length);
	const presented = (req: Request, subprotocol?: string): Presented | null => {
		const given = bearerToken(req.headers.get("authorization")) ?? subprotocol ?? null;
		if (tokenMatches(token, given)) return { kind: "main", phoneId: null, token: given };
		const phone = given ? phones?.phoneFor(given) : null;
		return phone ? { kind: "phone", phoneId: phone.id, token: given } : null;
	};
	const bearer = (req: Request): boolean => presented(req) !== null;
	const admit = (req: Request): Response | null => {
		const refused = outside(req);
		if (refused) return refused;
		const who = presented(req);
		if (!who) return fail(401, NOT_SIGNED_IN);
		if (who.token) phones?.seen(who.token);
		return null;
	};
	const jsonBody = async (req: Request): Promise<{ body: unknown } | Response> => {
		if (req.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return fail(415, "Expected a JSON body");
		try {
			return { body: await req.json() };
		} catch {
			return fail(400, "The body is not valid JSON");
		}
	};
	return {
		allowedHost,
		admit,
		admitMedia: req => {
			const refused = outside(req);
			if (refused) return refused;
			const key = new URL(req.url).searchParams.get(MEDIA_KEY_PARAM);
			if (bearer(req) || tokenMatches(media, key) || (key !== null && phones?.phoneForMediaKey(key))) return null;
			return fail(401, NOT_SIGNED_IN);
		},
		admitSocket(req) {
			const refused = outside(req);
			if (refused) return refused;
			if (!sameOrigin(req)) return fail(403, "forbidden origin");
			const who = presented(req, socketToken(req));
			if (!who) return fail(401, NOT_SIGNED_IN);
			if (who.token) phones?.seen(who.token);
			return null;
		},
		socketHeaders: req => (req.headers.has("sec-websocket-protocol") ? { "sec-websocket-protocol": SOCKET_PROTOCOL } : undefined),
		async writeBodyLocal(req) {
			if (!loopback.has(hostOf(req))) return fail(403, "forbidden host");
			if (!fetchSiteAllowed(req.headers.get("sec-fetch-site"), false)) return fail(403, "forbidden origin");
			if (!sameOrigin(req)) return fail(403, "forbidden origin");
			if (!tokenMatches(token, bearerToken(req.headers.get("authorization")))) return fail(403, "Only the desktop app can change Phone access.");
			return jsonBody(req);
		},
		async writeBody(req) {
			const refused = admit(req);
			if (refused) return refused;
			if (!sameOrigin(req)) return fail(403, "forbidden origin");
			return jsonBody(req);
		},
		signer(req) {
			const who = presented(req, socketToken(req));
			if (!who) return null;
			return who.kind === "phone" && who.phoneId ? { kind: "phone", id: who.phoneId } : { kind: "main" };
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
