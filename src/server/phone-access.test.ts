/** Phone access: the tailnet host and a phone's own token pass only while it is on, and the pairing code works once. */
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaKey } from "./auth";
import { guardsFor } from "./http";
import { PhoneAccess, PAIRING_TTL_MS } from "./phone-access";
import { phoneAccessRoutes } from "./phone-access-routes";
import type { Tailscale, TailscaleRun } from "./tailscale";
import { tailscaleOver } from "./tailscale";

const TOKEN = "main-token";

/** A Phone access store in its own file, so tests never share the user's. */
const fresh = (): PhoneAccess => new PhoneAccess(join(mkdtempSync(join(tmpdir(), "phone-access-")), "phone-access.json"));

const header = (host: string, token?: string, origin?: string): Request =>
	new Request(`http://${host}/api/sync`, { headers: { host, ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });

test("the tailnet host and a phone's token pass only while Phone access is on", () => {
	const phones = fresh();
	const guards = guardsFor(4317, TOKEN, phones);
	const dns = "mac.tailnet.ts.net";
	expect(guards.allowedHost(header(dns))).toBe(false);
	expect(guards.admit(header(dns, TOKEN))?.status).toBe(403);

	phones.setEnabled(true, dns);
	const paired = phones.exchange(phones.createCode().code, "Pixel", dns)!;
	const phone = header(dns, paired.token, `https://${dns}`);
	expect(guards.admit(phone)).toBeNull();
	expect(guards.admitSocket(phone)).toBeNull();
	expect(guards.admitSocket(header(dns, paired.token, `http://${dns}`))?.status).toBe(403);
	expect(guards.admit(header("other.ts.net", paired.token))?.status).toBe(403);

	phones.setEnabled(false, null);
	expect(guards.admit(phone)?.status).toBe(403);
	expect(phones.phoneFor(paired.token)).toBeNull();
});

test("a browser socket that signs in through its subprotocol is known as its phone, so removing the phone can close it", () => {
	const phones = fresh();
	const dns = "mac.tailnet.ts.net";
	phones.setEnabled(true, dns);
	const guards = guardsFor(4317, TOKEN, phones);
	const paired = phones.exchange(phones.createCode().code, "Pixel", dns)!;
	const socket = new Request(`http://${dns}/ws`, { headers: { host: dns, origin: `https://${dns}`, "sec-websocket-protocol": `omp-agents, bearer.${paired.token}` } });
	expect(guards.admitSocket(socket)).toBeNull();
	expect(guards.signer(socket)).toEqual({ kind: "phone", id: paired.phone.id });
});

test("a phone's token is refused on the Phone access routes, which take the main token on loopback only", async () => {
	const phones = fresh();
	phones.setEnabled(true, "mac.tailnet.ts.net");
	const guards = guardsFor(4317, TOKEN, phones);
	const paired = phones.exchange(phones.createCode().code, "Pixel", "mac.tailnet.ts.net")!;
	const routes = phoneAccessRoutes(guards, { phones, tailscale: tailscaleOver(async () => ({ stdout: "", code: 0 })), port: 4317 });
	const ask = (token: string, host: string) =>
		routes["/api/phone-access"]!.PUT!(new Request(`http://${host}/api/phone-access`, { method: "PUT", headers: { host, origin: `http://${host}`, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) }));

	expect((await ask(paired.token, "127.0.0.1:4317")).status).toBe(403);
	expect((await ask(TOKEN, "mac.tailnet.ts.net")).status).toBe(403);
	expect((await ask(TOKEN, "127.0.0.1:4317")).status).toBe(200);
});

test("a removed phone is refused at once", () => {
	const phones = fresh();
	phones.setEnabled(true, "mac.tailnet.ts.net");
	const guards = guardsFor(4317, TOKEN, phones);
	const paired = phones.exchange(phones.createCode().code, "Pixel", "mac.tailnet.ts.net")!;
	let closed: string | undefined;

	phones.onRemove(id => {
		closed = id;
	});
	expect(phones.remove(paired.phone.id)).toBe(true);
	expect(closed).toBe(paired.phone.id);
	expect(guards.admit(header("mac.tailnet.ts.net", paired.token, "https://mac.tailnet.ts.net"))?.status).toBe(401);
	expect(phones.remove(paired.phone.id)).toBe(false);
});

test("a pairing code works once and stops working after five minutes", () => {
	const phones = fresh();
	phones.setEnabled(true, "mac.tailnet.ts.net");
	const now = Date.now();
	const { code } = phones.createCode(now);
	const first = phones.exchange(code, "Pixel", "mac.tailnet.ts.net", now);
	expect(first?.mediaKey).toBe(mediaKey(first!.token));
	expect(phones.exchange(code, "Pixel", "mac.tailnet.ts.net", now)).toBeNull();
	expect(phones.phoneForMediaKey(first!.mediaKey)?.id).toBe(first!.phone.id);

	const stale = phones.createCode(now);
	expect(phones.exchange(stale.code, "Pixel", "mac.tailnet.ts.net", now + PAIRING_TTL_MS)).toBeNull();
	expect(phones.exchange("nope", "Pixel", "mac.tailnet.ts.net", now)).toBeNull();
});

test("turning Phone access on refuses when Tailscale already serves https 443 elsewhere", async () => {
	const phones = fresh();
	const guards = guardsFor(4317, TOKEN, phones);
	const run: TailscaleRun = async args => {
		if (args[0] === "status") return { stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.tailnet.ts.net." } }), code: 0 };
		if (args[0] === "serve" && args[1] === "status") return { stdout: JSON.stringify({ Web: { ":443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } } }), code: 0 };
		return { stdout: "", code: 0 };
	};
	const tailscale: Tailscale = tailscaleOver(run);
	const routes = phoneAccessRoutes(guards, { phones, tailscale, port: 4317 });
	const response = await routes["/api/phone-access"]!.PUT!(
		new Request("http://127.0.0.1:4317/api/phone-access", { method: "PUT", headers: { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) }),
	);
	expect([response.status, phones.enabled()]).toEqual([409, false]);
	expect(String((await response.json()).error)).toContain("443");
});

test("the pairing exchange answers only at the tailnet host, and tells a wrong code nothing", async () => {
	const phones = fresh();
	phones.setEnabled(true, "mac.tailnet.ts.net");
	const guards = guardsFor(4317, TOKEN, phones);
	const routes = phoneAccessRoutes(guards, { phones, tailscale: tailscaleOver(async () => null), port: 4317 });
	const post = (host: string, code: string) =>
		routes["/api/phone-access/pair"]!.POST!(new Request(`https://${host}/api/phone-access/pair`, { method: "POST", headers: { host, origin: `https://${host}`, "content-type": "application/json" }, body: JSON.stringify({ code, name: "Pixel" }) }));

	expect((await post("127.0.0.1:4317", "x")).status).toBe(403);
	expect((await post("mac.tailnet.ts.net", "wrong")).status).toBe(401);
	const { code } = phones.createCode();
	const ok = await post("mac.tailnet.ts.net", code);
	expect(ok.status).toBe(200);
	expect(typeof (await ok.json()).token).toBe("string");
});
