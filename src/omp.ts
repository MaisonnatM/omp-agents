/**
 * Loads the collab modules shipped inside the installed omp package so this
 * app speaks the exact protocol, crypto, and registry code of the omp version
 * that is running the sessions.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

export type Access = "view" | "control";

/** Subset of omp's `CollabHostSnapshot` (src/collab/registry.ts) this app reads. */
export interface HostSnapshot {
	instanceId: string;
	generation: number;
	pid: number;
	sessionId: string;
	sessionName: string | null;
	cwd: string;
	model: { provider: string; id: string } | null;
	startedAt: number;
	participants: number;
	relayConnected: boolean;
	inputRequired: boolean;
	busy: boolean | null;
	access: Access;
}

export type LinkErrorCode = "not_found" | "ambiguous" | "stale_generation" | "access_unavailable" | "unreachable";

/** Frame as decrypted by omp's relay client; parsed further by the transcript reducer. */
export type Frame = { t: string } & Record<string, unknown>;

/** Subset of omp's `CollabSocket` (src/collab/relay-client.ts). */
export interface CollabSocket {
	onOpen?: () => void;
	onFrame?: (frame: Frame, fromPeer: number) => void;
	onClose?: (reason: string, willReconnect: boolean) => void;
	connect(): void;
	send(frame: object): void;
	close(): void;
}

interface ParsedLink {
	wsUrl: string;
	key: Uint8Array;
	writeToken?: Uint8Array;
}

interface RegistryModule {
	listCollabHosts(): Promise<HostSnapshot[]>;
	resolveCollabHostLink(selector: string, access: Access): Promise<{ generation: number; access: Access; url: string }>;
	CollabLinkError: new (...args: never[]) => Error & { code: LinkErrorCode };
}
interface ProtocolModule {
	COLLAB_PROTO: number;
	parseCollabLink(link: string): ParsedLink | { error: string };
}
interface CryptoModule {
	importRoomKey(raw: Uint8Array): Promise<CryptoKey>;
}
interface RelayModule {
	CollabSocket: new (opts: { wsUrl: string; role: "guest"; key: CryptoKey }) => CollabSocket;
}

const PACKAGE_NAME = "@oh-my-pi/pi-coding-agent";

function findPackageDir(): string {
	const override = process.env.OMP_PACKAGE_DIR;
	if (override) return override;
	const bin = Bun.which("omp");
	if (!bin) throw new Error("`omp` is not on PATH; set OMP_PACKAGE_DIR to the installed @oh-my-pi/pi-coding-agent directory");
	let dir = dirname(realpathSync(bin));
	while (dir !== dirname(dir)) {
		const manifest = join(dir, "package.json");
		if (existsSync(manifest) && require(manifest).name === PACKAGE_NAME) return dir;
		dir = dirname(dir);
	}
	throw new Error(`could not find ${PACKAGE_NAME} above ${bin}; set OMP_PACKAGE_DIR`);
}

const packageDir = findPackageDir();
const collabDir = join(packageDir, "src", "collab");
if (!existsSync(join(collabDir, "relay-client.ts"))) {
	throw new Error(`${collabDir} does not ship the collab sources this app imports (omp too old or a compiled build)`);
}

export const ompVersion: string = require(join(packageDir, "package.json")).version;

// Dynamic imports: the module location is the user's omp install, only known at runtime.
const registry = (await import(join(collabDir, "registry.ts"))) as RegistryModule;
const protocol = (await import(join(collabDir, "protocol.ts"))) as ProtocolModule;
const crypto = (await import(join(collabDir, "crypto.ts"))) as CryptoModule;
const relay = (await import(join(collabDir, "relay-client.ts"))) as RelayModule;

export const COLLAB_PROTO = protocol.COLLAB_PROTO;

export const listHosts = registry.listCollabHosts;

export function linkErrorCode(err: unknown): LinkErrorCode | null {
	return err instanceof registry.CollabLinkError ? err.code : null;
}

export interface Room {
	socket: CollabSocket;
	generation: number;
	access: Access;
	/** base64url write token for `hello`; absent for view links. */
	writeToken: string | undefined;
}

/**
 * Ask the host for a link and open (but not connect) a guest socket for it.
 * The URL and key never leave this function's scope.
 */
export async function openRoom(instanceId: string, access: Access): Promise<Room> {
	const link = await registry.resolveCollabHostLink(instanceId, access);
	const parsed = protocol.parseCollabLink(link.url);
	if ("error" in parsed) throw new Error(`host returned an unparseable link: ${parsed.error}`);
	const key = await crypto.importRoomKey(parsed.key);
	return {
		socket: new relay.CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key }),
		generation: link.generation,
		access: link.access,
		writeToken: parsed.writeToken ? Buffer.from(parsed.writeToken).toString("base64url") : undefined,
	};
}
