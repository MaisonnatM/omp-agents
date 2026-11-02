/**
 * Whether the Mac is fully awake. A dark wake, the few seconds macOS wakes while asleep to check mail and the network,
 * turns on the CPU and the network but never graphics, which only a full wake turns on.
 */
import { run } from "./proc";

/** Whether the output of `pmset -g systemstate` shows a full wake; output without the capabilities reads as awake. */
export function isFullWake(systemstate: string): boolean {
	const capabilities = /^Current System Capabilities are: (.*)$/m.exec(systemstate)?.[1];
	return capabilities === undefined || capabilities.split(" ").includes("Graphics");
}

/** Whether the Mac is fully awake rather than in a dark wake; `true` off macOS, or when `pmset` cannot tell. */
export async function fullyAwake(): Promise<boolean> {
	if (process.platform !== "darwin") return true;
	const state = await run(["pmset", "-g", "systemstate"], { timeoutMs: 5000 }).catch(() => null);
	return state === null || state.code !== 0 || isFullWake(state.stdout);
}
