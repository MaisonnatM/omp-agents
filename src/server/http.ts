/** What every HTTP route shares: refusals, answers, and the checks that keep other sites and programs' pages out. */
import { errorText } from "../json";
import type { SettingsError } from "../shared";

/** A request the server refuses, with the HTTP status it answers. `conflict`: the file changed on disk since it was read. */
export class Rejected extends Error {
	constructor(
		readonly status: 400 | 404 | 409,
		message: string,
		readonly conflict = false,
	) {
		super(message);
	}
}

export const fail = (status: number, error: string, conflict = false): Response =>
	Response.json({ error, ...(conflict && { conflict: true }) } satisfies SettingsError, { status });

/** The JSON of `run`'s result, or the refusal it threw. */
export async function answer(run: () => Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await run());
	} catch (err) {
		if (err instanceof Rejected) return fail(err.status, err.message, err.conflict);
		return fail(500, errorText(err));
	}
}

export interface Guards {
	/** Whether the request names a host this server answers to. DNS rebinding cannot pass it. */
	allowedHost(req: Request): boolean;
	/** Whether the request came from a page this server served: the Host check plus an Origin that matches it. */
	sameOrigin(req: Request): boolean;
	/** A write's JSON body, or the response refusing it. Only this app's own page may write, and only with a JSON body, which a cross-site form cannot send. */
	writeBody(req: Request): Promise<{ body: unknown } | Response>;
}

/**
 * Only pages served by this app on `port` may open the socket, which carries full control of every session, or read omp's files.
 * DNS rebinding cannot pass the Host check; a cross-site page cannot pass the Origin check that also guards writes.
 */
export function guardsFor(port: number): Guards {
	const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
	const allowedHost = (req: Request): boolean => hosts.has(req.headers.get("host") ?? "");
	const sameOrigin = (req: Request): boolean => allowedHost(req) && req.headers.get("origin") === `http://${req.headers.get("host")}`;
	return {
		allowedHost,
		sameOrigin,
		async writeBody(req) {
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
