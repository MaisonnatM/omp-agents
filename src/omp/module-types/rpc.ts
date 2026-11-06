/** omp's RPC client (pi-coding-agent src/modes/rpc), which drives a dashboard session's omp. */
import type { RpcClient } from "../rpc";
import type { RpcHostTool } from "./rpc-host-tool";

export type { RpcHostTool };

/** omp's `RpcAgentProcess` (src/modes/rpc/rpc-client.ts): the transport `RpcClient` drives, which a session keeper's connection implements. */
export interface RpcProcess {
	readonly pid: number;
	readonly exited: Promise<number>;
	readonly stdin: { write(data: string): unknown; flush?(): unknown };
	readonly stdout: ReadableStream<Uint8Array>;
	peekStderr(): string;
	kill(reason?: unknown, graceMs?: number): void;
}
export interface RpcClientModule {
	/** `customTools` are sent with every `start()`, so a new process for the same session gets them again. */
	RpcClient: new (options: { spawn: (agentArgs: string[]) => Promise<RpcProcess>; args: string[]; customTools: RpcHostTool[] }) => RpcClient;
}
export interface RpcFrameModule {
	/** Reassembles protocol v2 chunk frames from parsed JSONL lines. */
	RpcFrameDecoder: new () => { push(value: unknown): object | undefined };
}
export interface UtilsModule {
	readJsonl(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown>;
}
