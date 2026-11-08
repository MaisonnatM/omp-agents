// omp-agents Google accounts: when omp is signed in to several Gmail or Google Calendar accounts, one MCP server each,
// tells a session at every prompt which server signs in as which address, and which addresses the user linked to the
// session's workspace in Settings › Integrations. The dashboard keeps `google-accounts.json`; this only reads it and
// omp's user `mcp.json`. It restricts no tool: a session may still use any account the user names.
// When a Gmail or Google Calendar server answers a tool call with HTTP 401, it tells the session the account is signed
// out and to ask the user to sign in again rather than retry, and reports the account once to the dashboard's
// `sign-in-inbox`, whose bell asks the user to sign in again. It never signs in itself.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CONFIG_DIR, leave, readJson } from "./inbox/client";

const ACCOUNTS_FILE = join(CONFIG_DIR, "google-accounts.json");

/** Where a session reports an account it found signed out, which `src/server/sign-in-inbox.ts` reads. */
const SIGN_IN_INBOX = join(CONFIG_DIR, "sign-in-inbox");

// The services of `MCP_SERVICES` in `src/shared/accounts.ts` that hold an account per server; change both together.
const SERVICES = [
	{ label: "Gmail", host: "gmailmcp.googleapis.com" },
	{ label: "Google Calendar", host: "calendarmcp.googleapis.com" },
];

/**
 * The part of server `name`'s tool names that omp mints from it, `mcp__<this>_<tool>`.
 * A copy of omp's `sanitizeMCPToolNamePart` (src/mcp/tool-bridge.ts), which an extension cannot import; keep it in step with omp's.
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

/**
 * The server whose tool call failed with HTTP 401, as omp's `formatMCPToolFailure` (src/mcp/errors.ts) words the
 * failure in `text`; `null` for any other result. Keep it in step with omp's.
 */
export function unauthorizedServer(text: string): string | null {
	if (!/^MCP failure$/m.test(text) || !/^code: 401$/m.test(text)) return null;
	return /^server: (.+)$/m.exec(text)?.[1] ?? null;
}

/** The label of the Google service whose host server `server` of `mcp` is on, enabled or not; `null` for none. */
export function serviceOf(mcp: McpFile, server: string): string | null {
	const url = mcp.mcpServers?.[server]?.url;
	if (typeof url !== "string" || !URL.canParse(url)) return null;
	const { host } = new URL(url);
	return SERVICES.find(service => service.host === host)?.label ?? null;
}

/** What a session is told instead of the 401 of `label`'s server `server`. */
export function signedOutText(label: string, server: string): string {
	return `${label} is signed out: its MCP server ${server} answered HTTP 401. Do not retry this tool or any other ${label} tool, and do not try to sign in yourself. Tell the user ${label} is signed out and ask them to sign in to it again in the omp-agents dashboard, under Settings › Integrations.`;
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
	// omp's `getMCPConfigPath("user")`.
	const mcpFile = (): McpFile => (readJson(join(pi.pi.getAgentDir(), "mcp.json")) ?? {}) as McpFile;
	// Read on every prompt, so an account added or linked mid-session shows in the next turn.
	pi.on("before_agent_start", (event, ctx) => {
		const { addresses = {}, links = {} } = (readJson(ACCOUNTS_FILE) ?? {}) as Partial<AccountsFile>;
		const services = servicesOf(mcpFile(), { addresses, links });
		if (services.every(service => service.accounts.length < 2)) return;
		let place = places.get(ctx.cwd);
		if (!place) {
			place = placeOf(ctx.cwd);
			places.set(ctx.cwd, place);
		}
		const dir = workspaceOf(place, [...new Set(Object.values(links).flat())]);
		const linked = dir === null ? [] : Object.keys(links).filter(address => links[address]?.includes(dir));
		const text = accountsText(services, dir === null ? null : { dir, addresses: linked });
		if (text === null) return;
		return { systemPrompt: [...event.systemPrompt, text] };
	});

	// Each account is reported once a session: the dashboard keeps the first report until the account works again.
	const reported = new Set<string>();
	pi.on("tool_result", event => {
		if (!event.isError) return;
		const server = unauthorizedServer(event.content.map(part => (part.type === "text" ? part.text : "")).join("\n"));
		const label = server === null ? null : serviceOf(mcpFile(), server);
		if (server === null || label === null) return;
		if (!reported.has(server)) {
			reported.add(server);
			leave(SIGN_IN_INBOX, { v: 1, server, at: Date.now() });
		}
		return { content: [{ type: "text", text: signedOutText(label, server) }], isError: true };
	});
}
