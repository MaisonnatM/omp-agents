// omp-agents Google accounts: when omp is signed in to several Gmail or Google Calendar accounts, one MCP server each,
// tells a session at every prompt which server signs in as which address, and which addresses the user placed in the
// session's space in Settings › Integrations. The dashboard keeps `google-accounts.json` and `workspaces.json`; this only
// reads them and omp's user `mcp.json`. It restricts no tool: a session may still use any account the user names.
// When a Gmail or Google Calendar server answers a tool call with HTTP 401, it tells the session the account is signed
// out and to ask the user to sign in again rather than retry, and reports the account once to the dashboard's
// `sign-in-inbox`, whose bell asks the user to sign in again. It never signs in itself.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CONFIG_DIR, inbox, readJson } from "./inbox/client";

const ACCOUNTS_FILE = join(CONFIG_DIR, "google-accounts.json");
const WORKSPACES_FILE = join(CONFIG_DIR, "workspaces.json");
/** The dashboard's personal directory, as `personalDir` in `src/paths.ts` names it. */
const PERSONAL_DIR = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "omp-agents", "personal");

/** Where a session reports an account it found signed out, which `src/server/sign-in-inbox.ts` reads. */
const SIGN_IN_INBOX = inbox<{ v: 1; server: string; at: number }>(join(CONFIG_DIR, "sign-in-inbox"));

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

/** The part of `google-accounts.json` this reads, as `src/server/google-accounts-file.ts` writes it: `personal` lists the addresses in the Personal space. */
export interface AccountsFile {
	addresses: Record<string, string>;
	personal: string[];
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

/** Where a session runs, for its space: its real directory, and the real main checkout of the repository it is in, `null` outside git. */
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

export type Space = "personal" | "work";

const SPACE_LABELS: Record<Space, string> = { personal: "Personal", work: "Work" };

/**
 * The space of a session at `place`, as `spaces().of` in `src/shared/workspaces.ts` decides it: Personal in the personal
 * directory `personalDir`, or when the workspace it counts in, the main checkout of a linked worktree, else its own
 * directory, is one of `personal`; else Work.
 */
export function spaceOf(place: Place, personal: readonly string[], personalDir: string): Space {
	if (place.dir === realOf(personalDir)) return "personal";
	const linked = place.main !== null && place.dir !== place.main && !place.dir.startsWith(place.main + sep);
	const workspace = linked ? place.main : place.dir;
	return personal.some(dir => realOf(dir) === workspace) ? "personal" : "work";
}

/**
 * What a session in `space` is told about the Google accounts of `services`, `null` when no service has two: each
 * account of a service that has, and, when the user placed only some of them in `space`, to use those. `personal` lists
 * the addresses in the Personal space; every other one is in Work.
 */
export function accountsText(services: readonly ServiceAccounts[], space: Space, personal: readonly string[]): string | null {
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
	const placed = [...known].filter(address => personal.includes(address) === (space === "personal"));
	if (placed.length > 0 && placed.length < known.size) {
		const which = placed.length === 1 ? `${placed[0]} in it: use that account` : `${placed.join(", ")} in it: use those accounts`;
		lines.push(`This session is in the user's ${SPACE_LABELS[space]} space, and the user placed ${which} for this session's mail and calendar unless the user names another account.`);
	}
	return lines.join("\n");
}

export default function googleAccounts(pi: ExtensionAPI) {
	const places = new Map<string, Place>();
	// omp's `getMCPConfigPath("user")`.
	const mcpFile = (): McpFile => (readJson(join(pi.pi.getAgentDir(), "mcp.json")) ?? {}) as McpFile;
	// Read on every prompt, so an account added or placed mid-session, or a workspace moved to the other space, shows in the next turn.
	pi.on("before_agent_start", (event, ctx) => {
		const { addresses = {}, personal = [] } = (readJson(ACCOUNTS_FILE) ?? {}) as Partial<AccountsFile>;
		const services = servicesOf(mcpFile(), { addresses, personal });
		if (services.every(service => service.accounts.length < 2)) return;
		let place = places.get(ctx.cwd);
		if (!place) {
			place = placeOf(ctx.cwd);
			places.set(ctx.cwd, place);
		}
		const { personal: workspaces = [] } = (readJson(WORKSPACES_FILE) ?? {}) as { personal?: string[] };
		const text = accountsText(services, spaceOf(place, workspaces, PERSONAL_DIR), personal);
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
			SIGN_IN_INBOX.leave({ v: 1, server, at: Date.now() });
		}
		return { content: [{ type: "text", text: signedOutText(label, server) }], isError: true };
	});
}
