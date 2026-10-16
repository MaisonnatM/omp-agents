// omp-agents Google accounts: when omp is signed in to several Gmail or Google Calendar accounts, one MCP server each,
// tells a session at every prompt which server signs in as which address, and which addresses the user linked to the
// session's workspace in Settings › Integrations. The dashboard keeps `google-accounts.json`; this only reads it and
// omp's user `mcp.json`. It restricts no tool: a session may still use any account the user names.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const ACCOUNTS_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "google-accounts.json");

// The services of `MCP_SERVICES` in `src/shared/accounts.ts` that hold an account per server; change both together.
const SERVICES = [
	{ label: "Gmail", host: "gmailmcp.googleapis.com" },
	{ label: "Google Calendar", host: "calendarmcp.googleapis.com" },
];

/**
 * The part of server `name`'s tool names that omp mints from it, `mcp__<this>_<tool>`.
 * omp's `sanitizeMCPToolNamePart` (src/mcp/tool-bridge.ts), which an extension cannot import, as `toolPrefixOf` in
 * `src/integrations.ts` also copies it; change all three together.
 */
const sanitized = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "") || "server";

/** The part of `google-accounts.json` this reads, as `src/server/google-accounts-file.ts` writes it. */
export interface AccountsFile {
	addresses: Record<string, string>;
	links: Record<string, string[]>;
}

/** The part of omp's `mcp.json` this reads. */
export interface McpFile {
	mcpServers?: Record<string, { url?: unknown; enabled?: unknown }>;
	disabledServers?: unknown;
}

/** One account: its server's name in omp's MCP config and the address it signs in as, `null` until the dashboard learns it. */
export interface Account {
	server: string;
	address: string | null;
}

/** A Google service and its accounts, one per enabled server on its host, in the config's order. */
export interface ServiceAccounts {
	label: string;
	accounts: Account[];
}

/** Where a session runs, for linking: its real directory, and the real main checkout of the repository it is in, `null` outside git. */
export interface Place {
	dir: string;
	main: string | null;
}

const realOf = (path: string): string => {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
};

function readJson<T>(path: string, empty: T): T {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return empty;
	}
}

/** Each Google service's accounts: the enabled servers of `mcp` on its host, each with the address `accounts` learned for it. */
export function servicesOf(mcp: McpFile, accounts: AccountsFile): ServiceAccounts[] {
	const disabled = new Set(Array.isArray(mcp.disabledServers) ? mcp.disabledServers : []);
	const servers = Object.entries(mcp.mcpServers ?? {}).filter(([name, config]) => !disabled.has(name) && config.enabled !== false);
	return SERVICES.map(({ label, host }) => ({
		label,
		accounts: servers
			.filter(([, { url }]) => typeof url === "string" && URL.canParse(url) && new URL(url).host === host)
			.map(([server]) => ({ server, address: accounts.addresses[server] ?? null })),
	}));
}

/** `cwd` as a {@link Place}; the main checkout is the parent of the repository's common `.git` directory, which a linked worktree shares. */
export function placeOf(cwd: string): Place {
	const dir = realOf(cwd);
	try {
		const common = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return { dir, main: basename(common) === ".git" ? realOf(dirname(common)) : null };
	} catch {
		return { dir, main: null };
	}
}

/**
 * The workspace of `workspaces` that `place` belongs to, as `workspaces` names it: the deepest one its directory is or
 * is under, else the deepest one its main checkout is or is under; `null` for none.
 */
export function workspaceOf(place: Place, workspaces: readonly string[]): string | null {
	const real = workspaces.map(workspace => ({ workspace, real: realOf(workspace) }));
	for (const dir of [place.dir, place.main]) {
		if (dir === null) continue;
		const inside = real.filter(({ real }) => dir === real || dir.startsWith(real.endsWith(sep) ? real : real + sep));
		if (inside.length > 0) return inside.reduce((deepest, next) => (next.real.length > deepest.real.length ? next : deepest)).workspace;
	}
	return null;
}

/**
 * What a session is told about the Google accounts of `services`, `null` when no service has two: each account of a
 * service that has, and, when the session's workspace links addresses among them, to use those.
 */
export function accountsText(services: readonly ServiceAccounts[], workspace: { dir: string; addresses: readonly string[] } | null): string | null {
	const several = services.filter(service => service.accounts.length >= 2);
	if (several.length === 0) return null;
	const lines = [
		"omp is signed in to several Google accounts, one MCP server each, and each server's tools start with its prefix.",
		...several.flatMap(({ label, accounts }) => [
			`${label}:`,
			...accounts.map(({ server, address }) => `- ${server}: ${address ?? "address not known yet"}, tools \`mcp__${sanitized(server)}_\``),
		]),
	];
	const known = new Set(several.flatMap(({ accounts }) => accounts.flatMap(({ address }) => (address === null ? [] : [address]))));
	const linked = workspace?.addresses.filter(address => known.has(address)) ?? [];
	if (workspace && linked.length > 0) {
		const which = linked.length === 1 ? `${linked[0]}: use that account` : `${linked.join(", ")}: use those accounts`;
		lines.push(`The user linked this workspace, ${workspace.dir}, to ${which} for this workspace's mail and calendar unless the user names another account.`);
	}
	return lines.join("\n");
}

export default function googleAccounts(pi: ExtensionAPI) {
	const places = new Map<string, Place>();
	// Read on every prompt, so an account added or linked mid-session shows in the next turn.
	pi.on("before_agent_start", (event, ctx) => {
		const accounts = readJson<AccountsFile>(ACCOUNTS_FILE, { addresses: {}, links: {} });
		// omp's `getMCPConfigPath("user")`.
		const services = servicesOf(readJson<McpFile>(join(pi.pi.getAgentDir(), "mcp.json"), {}), accounts);
		if (services.every(service => service.accounts.length < 2)) return;
		let place = places.get(ctx.cwd);
		if (!place) {
			place = placeOf(ctx.cwd);
			places.set(ctx.cwd, place);
		}
		const dir = workspaceOf(place, [...new Set(Object.values(accounts.links).flat())]);
		const addresses = dir === null ? [] : Object.keys(accounts.links).filter(address => accounts.links[address]?.includes(dir));
		const text = accountsText(services, dir === null ? null : { dir, addresses });
		if (text === null) return;
		return { systemPrompt: [...event.systemPrompt, text] };
	});
}
