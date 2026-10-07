import { cpus, freemem, platform, totalmem } from "node:os";
import { run } from "./proc";
import type { SystemLoad } from "./shared/system";

/** CPU time summed over every core since boot, in milliseconds. */
export interface CpuTimes {
	busy: number;
	total: number;
}

function cpuTimes(): CpuTimes {
	let busy = 0;
	let total = 0;
	for (const { times } of cpus()) {
		const all = times.user + times.nice + times.sys + times.idle + times.irq;
		total += all;
		busy += all - times.idle;
	}
	return { busy, total };
}

/** The percent of CPU time spent busy between two samples, `null` when no time passed between them. */
export function busyPercent(before: CpuTimes, after: CpuTimes): number | null {
	const total = after.total - before.total;
	return total > 0 ? ((after.busy - before.busy) / total) * 100 : null;
}

/**
 * The bytes the system can hand out without swapping. macOS counts only never-used pages as free, so `os.freemem()`
 * reads a few hundred megabytes there; the kernel's memory status level is the free percentage that `memory_pressure` reports.
 */
async function availableMemory(): Promise<number> {
	if (platform() !== "darwin") return freemem();
	const { code, stdout } = await run(["sysctl", "-n", "kern.memorystatus_level"]);
	const percent = Number(stdout.trim());
	return code === 0 && stdout.trim() !== "" && percent >= 0 && percent <= 100 ? Math.round((totalmem() * percent) / 100) : freemem();
}

/** Reads the machine's load; each read's CPU percent covers the time since the previous read, or since construction. */
export class SystemLoadReader {
	#last = cpuTimes();
	#lastPercent: number | null = null;

	async read(): Promise<SystemLoad> {
		const now = cpuTimes();
		// Two reads within the same clock tick measure nothing, so the previous percent stands.
		this.#lastPercent = busyPercent(this.#last, now) ?? this.#lastPercent;
		this.#last = now;
		return { cpuPercent: this.#lastPercent, memoryAvailable: await availableMemory(), memoryTotal: totalmem() };
	}
}
