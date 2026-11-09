/** Phone access's HTTP routes: the desktop window turns it on, pairs a phone, and removes one; the phone exchanges its code. */
import { isObject } from "../json";
import { fail, type Guards } from "./http";
import type { PhoneAccess } from "./phone-access";
import type { Tailscale } from "./tailscale";

/** What the Phone access routes read. */
export interface PhoneAccessRoutesEnv {
	phones: PhoneAccess;
	tailscale: Tailscale;
	port: number;
}

const NAME = /^[\p{L}\p{N} .'_-]{0,60}$/u;

/** The routes, spread into the server's own rather than the route kit's: the desktop window's writes refuse a phone's token. */
export function phoneAccessRoutes(guards: Guards, { phones, tailscale, port }: PhoneAccessRoutesEnv): Record<string, Partial<Record<"GET" | "POST" | "PUT" | "DELETE", (req: Request) => Promise<Response>>>> {
	const desktop = async (req: Request, run: (body: unknown) => Promise<Response>): Promise<Response> => {
		const guarded = await guards.writeBodyLocal(req);
		return guarded instanceof Response ? guarded : run(guarded.body);
	};
	return {
		"/api/phone-access": {
			GET: async req => {
				const refused = guards.admit(req);
				if (refused) return refused;
				if (!guards.signer(req) || guards.signer(req)?.kind === "phone") return fail(403, "Only the desktop app can read Phone access.");
				const status = await tailscale.status();
				if (status.dnsName) phones.refreshDns(status.dnsName);
				return Response.json({ ...phones.view(), tailscale: status.reason });
			},
			PUT: req =>
				desktop(req, async body => {
					if (!isObject(body) || typeof body.enabled !== "boolean") return fail(400, "Expected { enabled }");
					if (!body.enabled) {
						phones.setEnabled(false, null);
						await tailscale.unserve();
						return Response.json(phones.view());
					}
					const status = await tailscale.status();
					if (!status.dnsName) return fail(409, status.reason ?? "Tailscale is not available.");
					const served = await tailscale.serve(port);
					if (!served.ok) return fail(409, served.reason);
					phones.setEnabled(true, status.dnsName);
					return Response.json(phones.view());
				}),
		},
		"/api/phone-access/pairing": {
			PUT: req =>
				desktop(req, async () => {
					if (!phones.enabled()) return fail(409, "Turn on Phone access before pairing a phone.");
					const { code, expiresAt } = phones.createCode();
					const dns = phones.tailnetHost();
					return Response.json({ url: `https://${dns}/#pair=${code}`, expiresAt });
				}),
		},
		"/api/phone-access/devices": {
			PUT: req =>
				desktop(req, async body => {
					if (!isObject(body) || typeof body.id !== "string") return fail(400, "Expected { id }");
					return phones.remove(body.id) ? Response.json(phones.view()) : fail(404, "That phone is not paired.");
				}),
		},
		/** The one route that takes no token: the phone trades its one-time code for its own, at the tailnet address only. */
		"/api/phone-access/pair": {
			POST: async req => {
				const host = req.headers.get("host") ?? "";
				if (phones.tailnetHost() !== host.split(":")[0]) return fail(403, "forbidden host");
				if (req.headers.get("origin") !== `https://${host}`) return fail(403, "forbidden origin");
				let body: unknown;
				try {
					body = await req.json();
				} catch {
					return fail(400, "The body is not valid JSON");
				}
				if (!isObject(body) || typeof body.code !== "string" || typeof body.name !== "string" || !NAME.test(body.name)) {
					return fail(400, "Expected { code, name }");
				}
				const exchanged = phones.exchange(body.code, body.name, host);
				if (!exchanged) return fail(401, "That pairing code does not work.");
				return Response.json({ token: exchanged.token, mediaKey: exchanged.mediaKey });
			},
		},
	};
}
