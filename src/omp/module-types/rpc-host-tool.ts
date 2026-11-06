/**
 * Subset of omp's `RpcClientCustomTool` (src/modes/rpc/rpc-client.ts): a tool this process serves to the session over RPC.
 * omp's adapter (src/modes/rpc/host-tools.ts) makes it strict, so `parameters` sets `additionalProperties: false` and
 * requires every property, an optional one as nullable; without `loadMode: "essential"` omp only makes it discoverable.
 * A thrown error reaches the model as the tool's error.
 * Kept out of `rpc.ts` because that module's client type is what `module-types/rpc.ts` names, and this tool is what `rpc.ts` serves.
 */
export interface RpcHostTool {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	loadMode: "essential";
	execute(params: Record<string, unknown>, context: { toolCallId: string; signal: AbortSignal }): Promise<string>;
}
