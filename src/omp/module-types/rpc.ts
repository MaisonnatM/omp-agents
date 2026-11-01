/** omp's RPC client (pi-coding-agent src/modes/rpc), which drives a dashboard session's omp. */
import type { RpcClient } from "../rpc";

/** omp's `RpcAgentProcess` (src/modes/rpc/rpc-client.ts): the transport `RpcClient` drives, which a session keeper's connection implements. */
export interface RpcProcess {
	readonly pid: number;
	readonly exited: Promise<number>;
	readonly stdin: { write(data: string): unknown; flush?(): unknown };
	readonly stdout: ReadableStream<Uint8Array>;
	peekStderr(): string;
	kill(reason?: unknown, graceMs?: number): void;
}
/**
 * Subset of omp's `RpcClientCustomTool` (src/modes/rpc/rpc-client.ts): a tool this process serves to the session over RPC.
 * omp's adapter (src/modes/rpc/host-tools.ts) makes it strict, so `parameters` sets `additionalProperties: false` and
 * requires every property, an optional one as nullable; without `loadMode: "essential"` omp only makes it discoverable.
 * A thrown error reaches the model as the tool's error.
 */
export interface RpcHostTool {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	loadMode: "essential";
	execute(params: Record<string, unknown>, context: { toolCallId: string; signal: AbortSignal }): Promise<string>;
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
