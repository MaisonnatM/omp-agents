/** omp's Collab: the registry of terminal sessions that publish themselves, and the encrypted rooms they host. */
import { crypto, protocol, registry, relay } from "./modules";

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
