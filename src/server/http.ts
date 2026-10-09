/** What every HTTP route shares: refusals, answers, and the checks that keep other sites and programs' pages out. */
import { errorText } from "../json";
import type { SettingsError } from "../shared/models";
import { dashboardHosts } from "./address";
import { COOKIE, cookieValue, fetchSiteAllowed, tokenMatches } from "./auth";

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

/** How a request shows it holds the access token: a login cookie, or the `?token=` of the printed URL. */
export type Credential = "cookie" | "login";

export interface Guards {
	/** Whether the request names a host this server answers to. DNS rebinding cannot pass it. */
	allowedHost(req: Request): boolean;
	/** What proves a request for the page holds the token, or `null`: the `?token=` of the printed URL wins over a cookie. */
	credential(req: Request): Credential | null;
	/**
	 * The response refusing an API or asset request, or `null` to answer it: the Host check, then `Sec-Fetch-Site`
	 * (403), then the login cookie (401). A `?token=` is no credential here, and a stray one beside the cookie changes nothing.
	 */
	admit(req: Request): Response | null;
	/** `admit` plus an Origin that matches the Host, for the socket upgrade, which carries full control of every session. */
	admitSocket(req: Request): Response | null;
	/** A write's JSON body, or the response refusing it. Only this app's own page may write, and only with a JSON body, which a cross-site form cannot send. */
	writeBody(req: Request): Promise<{ body: unknown } | Response>;
}

/**
 * Only the page this app served on `port`, logged in with `token`, may open the socket or read omp's files.
 * DNS rebinding cannot pass the Host check; a cross-site page cannot pass the `Sec-Fetch-Site` or Origin checks,
 * and its requests carry no `Strict` cookie. A local program must hold the token, which only the user can read.
 */
export function guardsFor(port: number, token: string): Guards {
	const hosts = new Set(dashboardHosts(port));
	const allowedHost = (req: Request): boolean => hosts.has(req.headers.get("host") ?? "");
	const sameOrigin = (req: Request): boolean => allowedHost(req) && req.headers.get("origin") === `http://${req.headers.get("host")}`;
	const signedIn = (req: Request): boolean => tokenMatches(token, cookieValue(req.headers.get("cookie"), COOKIE));
	// The printed URL wins over a cookie, so its redirect always takes the token out of the address bar and history.
	const credential = (req: Request): Credential | null => (tokenMatches(token, new URL(req.url).searchParams.get("token")) ? "login" : signedIn(req) ? "cookie" : null);
	const admit = (req: Request): Response | null => {
		if (!allowedHost(req)) return fail(403, "forbidden host");
		if (!fetchSiteAllowed(req.headers.get("sec-fetch-site"), false)) return fail(403, "forbidden origin");
		return signedIn(req) ? null : fail(401, "Not signed in: open the URL that the server printed");
	};
	return {
		allowedHost,
		credential,
		admit,
		admitSocket: req => admit(req) ?? (sameOrigin(req) ? null : fail(403, "forbidden origin")),
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
	};
}
