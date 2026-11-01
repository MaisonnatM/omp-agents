/** omp's Collab (pi-coding-agent src/collab): the registry of published terminal sessions and the encrypted rooms they host. */
import type { Access, CollabSocket, HostSnapshot, LinkErrorCode } from "../collab";

export interface ParsedLink {
	wsUrl: string;
	key: Uint8Array;
	writeToken?: Uint8Array;
}
export interface RegistryModule {
	listCollabHosts(): Promise<HostSnapshot[]>;
	resolveCollabHostLink(selector: string, access: Access): Promise<{ generation: number; access: Access; url: string }>;
	CollabLinkError: new (...args: never[]) => Error & { code: LinkErrorCode };
}
export interface ProtocolModule {
	COLLAB_PROTO: number;
	parseCollabLink(link: string): ParsedLink | { error: string };
}
export interface CryptoModule {
	importRoomKey(raw: Uint8Array): Promise<CryptoKey>;
}
export interface RelayModule {
	CollabSocket: new (opts: { wsUrl: string; role: "guest"; key: CryptoKey }) => CollabSocket;
}
