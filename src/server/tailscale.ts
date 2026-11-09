/** Tailscale Serve for Phone access: the CLI, read only through an injectable runner so tests never call it. */
import { existsSync } from "node:fs";
import { run } from "../proc";

/** Where the CLI lives, the first that exists: the desktop app's PATH may lack `/usr/local/bin`. */
const CANDIDATES = ["/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "tailscale"];

const found = (): string | null => CANDIDATES.find(candidate => candidate === "tailscale" || existsSync(candidate)) ?? null;

/** What the server asks Tailscale, and what it answers. `dnsName` is null while Tailscale is stopped, signed out, or missing. */
export interface Tailscale {
	/** The tailnet DNS name, without its trailing dot, or `null` with `reason` while there is none. */
	status(): Promise<{ dnsName: string | null; reason: string | null }>;
	/** Serves `https://<dns>:443` to `http://127.0.0.1:port`, or refuses with `reason` when 443 already serves something else. */
	serve(port: number): Promise<{ ok: true } | { ok: false; reason: string }>;
	/** Turns off what this server served on https 443; another program's config stays. */
	unserve(): Promise<void>;
}

/** One CLI run: its arguments and what it printed, or `null` when the CLI could not run. */
export type TailscaleRun = (args: string[]) => Promise<{ stdout: string; code: number } | null>;

/** The real CLI, the first of {@link CANDIDATES} that exists; `null` when none does. */
export const cliRunner = (): TailscaleRun => {
	const bin = found();
	if (!bin) return async () => null;
	return async args => {
		try {
			const result = await run([bin, ...args], { timeoutMs: 15_000 });
			return { stdout: result.stdout, code: result.code };
		} catch {
			return null;
		}
	};
};

/** `OMP_AGENTS_TAILSCALE_DNS`, a DNS name the smoke server answers as its tailnet's, without calling the CLI. */
const fakeDns = (): string | null => {
	const name = process.env.OMP_AGENTS_TAILSCALE_DNS?.replace(/\.$/, "");
	return name && /^[a-z0-9.-]+\.ts\.net$/i.test(name) ? name : null;
};

interface ServeStatus {
	TCP?: Record<string, { HTTPS?: boolean; TCPForward?: string }>;
	Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
}

/** What https 443 serves now: the proxy target, or `null` while it serves nothing. */
function servedTarget(status: ServeStatus): string | null {
	const web = status.Web?.[":443"] ?? status.Web?.["${TS_CERT_DOMAIN}:443"];
	for (const handler of Object.values(web?.Handlers ?? {})) if (handler.Proxy) return handler.Proxy;
	const tcp = status.TCP?.["443"];
	return tcp?.HTTPS ? (tcp.TCPForward ?? null) : null;
}

const STOPPED = "Tailscale is stopped or signed out.";
const MISSING = "Tailscale is not installed.";

/**
 * A {@link Tailscale} over `run`, defaulting to {@link cliRunner}.
 * `OMP_AGENTS_TAILSCALE_DNS` stands in for the whole CLI: status reports that name and serve pretends to succeed,
 * so a smoke server can prove the tailnet host without Tailscale running or its serve config changing.
 */
export function tailscaleOver(runCli: TailscaleRun = cliRunner()): Tailscale {
	const fake = fakeDns();
	if (fake) {
		return {
			status: async () => ({ dnsName: fake, reason: null }),
			serve: async () => ({ ok: true }),
			unserve: async () => {},
		};
	}
	return {
		async status() {
			if (fake) return { dnsName: fake, reason: null };
			const result = await runCli(["status", "--json"]);
			if (!result) return { dnsName: null, reason: MISSING };
			if (result.code !== 0) return { dnsName: null, reason: STOPPED };
			let parsed: { BackendState?: string; Self?: { DNSName?: string } };
			try {
				parsed = JSON.parse(result.stdout) as typeof parsed;
			} catch {
				return { dnsName: null, reason: STOPPED };
			}
			const name = parsed.Self?.DNSName?.replace(/\.$/, "") ?? "";
			if (parsed.BackendState !== "Running" || !name) return { dnsName: null, reason: STOPPED };
			return { dnsName: name, reason: null };
		},
		async serve(port) {
			const status = await runCli(["serve", "status", "--json"]);
			if (!status || status.code !== 0) return { ok: false, reason: status ? STOPPED : MISSING };
			let parsed: ServeStatus = {};
			try {
				parsed = status.stdout.trim() ? (JSON.parse(status.stdout) as ServeStatus) : {};
			} catch {
				return { ok: false, reason: "Tailscale serve status is not JSON." };
			}
			const target = `http://127.0.0.1:${port}`;
			const current = servedTarget(parsed);
			if (current && current.replace(/\/$/, "") !== target) {
				return { ok: false, reason: `Tailscale already serves https:// on port 443 to ${current}. Turn that off in Tailscale before turning on Phone access.` };
			}
			if (!current) {
				const served = await runCli(["serve", "--bg", "--https=443", target]);
				if (!served || served.code !== 0) return { ok: false, reason: "Tailscale could not serve this dashboard." };
			}
			return { ok: true };
		},
		async unserve() {
			await runCli(["serve", "--https=443", "off"]);
		},
	};
}
