/**
 * This Mac's memory pressure, read from one `sysctl` and `vm_stat`, with no dashboard state, so the process watch and
 * `heavy.py` read the same signals. `docs/architecture/session-processes.md` says what each signal means.
 */
import { run } from "./proc";
import type { MemoryReading, Pressure } from "./shared/resources";

/** The kernel's memory pressure level: 1 normal, 2 warn, 4 critical. */
type KernelLevel = 1 | 2 | 4;

interface RawPressure {
	kernelLevel: KernelLevel;
	/** `kern.memorystatus_level`: the share of memory macOS counts as available, 0 to 100. */
	availablePercent: number;
	swapOutBytesPerMin: number;
}

/** Available memory under which pressure is warn, then critical, in percent. */
const WARN_AVAILABLE_PERCENT = 20;
const CRITICAL_AVAILABLE_PERCENT = 8;
/** Swap-out rates from which pressure is warn, then critical: a low available figure alone misleads on macOS. */
const WARN_SWAP_OUT_BYTES_PER_MIN = 128 * 1024 ** 2;
const CRITICAL_SWAP_OUT_BYTES_PER_MIN = 512 * 1024 ** 2;
/** Reads in a row calmer than the pressure that leaving it needs. */
const CALM_TICKS_TO_LEAVE = 2;

const SYSCTL_ARGV = ["sysctl", "-n", "kern.memorystatus_vm_pressure_level", "kern.memorystatus_level", "vm.swapusage", "hw.memsize"];
const READ_TIMEOUT_MS = 5_000;

const RANK: Record<Exclude<Pressure, "unknown">, number> = { normal: 0, warn: 1, critical: 2 };

/** What `raw` alone says, before hysteresis. */
function instantOf({ kernelLevel, availablePercent, swapOutBytesPerMin }: RawPressure): Exclude<Pressure, "unknown"> {
	if (kernelLevel === 4 || availablePercent < CRITICAL_AVAILABLE_PERCENT || swapOutBytesPerMin >= CRITICAL_SWAP_OUT_BYTES_PER_MIN) return "critical";
	if (kernelLevel === 2 || availablePercent < WARN_AVAILABLE_PERCENT || swapOutBytesPerMin >= WARN_SWAP_OUT_BYTES_PER_MIN) return "warn";
	return "normal";
}

/**
 * The pressure `raw` gives after `previous`: a rise counts at once, and a fall only once `calmTicks`, the reads in a row
 * calmer than `previous` including this one, reach 2. After `unknown` it is what `raw` says.
 */
export function pressureOf(raw: RawPressure, previous: Pressure, calmTicks: number): Pressure {
	const instant = instantOf(raw);
	if (previous === "unknown" || RANK[instant] >= RANK[previous]) return instant;
	return calmTicks >= CALM_TICKS_TO_LEAVE ? instant : previous;
}

const UNIT_BYTES: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

/** The used bytes of `vm.swapusage`'s `total = 5120.00M  used = 3673.44M  free = …`; `null` when it says otherwise. */
function swapUsedOf(line: string): number | null {
	const match = /used = ([\d.]+)([KMG])/.exec(line);
	return match ? Number(match[1]) * UNIT_BYTES[match[2]!]! : null;
}

/** Every byte swapped out since boot, from `vm_stat`'s page size and `Swapouts:` line; `null` when it lacks either. */
function swapOutBytesOf(vmStat: string): number | null {
	const pageSize = /page size of (\d+) bytes/.exec(vmStat);
	const swapOuts = /^Swapouts:\s+(\d+)\./m.exec(vmStat);
	return pageSize && swapOuts ? Number(pageSize[1]) * Number(swapOuts[1]) : null;
}

const isKernelLevel = (value: number): value is KernelLevel => value === 1 || value === 2 || value === 4;

const unknownReading = (at: number, previous: MemoryReading | null): MemoryReading => ({
	pressure: "unknown",
	totalBytes: previous?.totalBytes ?? 0,
	availableBytes: 0,
	swapUsedBytes: 0,
	swapOutBytesPerMin: 0,
	swapOutBytes: previous?.swapOutBytes ?? 0,
	calmTicks: 0,
	at,
});

/**
 * Reads memory now: the swap-out rate since `previous`, and its pressure after `previous`'s with hysteresis.
 * A read that fails, or says what this code does not parse, is `unknown`.
 */
export async function readMemory(previous: MemoryReading | null): Promise<MemoryReading> {
	const at = Date.now();
	try {
		const [sysctl, vmStat] = await Promise.all([run(SYSCTL_ARGV, { timeoutMs: READ_TIMEOUT_MS }), run(["vm_stat"], { timeoutMs: READ_TIMEOUT_MS })]);
		if (sysctl.code !== 0 || vmStat.code !== 0) return unknownReading(at, previous);
		const [levelLine, availableLine, swapLine, totalLine] = sysctl.stdout.trim().split("\n");
		const kernelLevel = Number(levelLine);
		const availablePercent = Number(availableLine);
		const totalBytes = Number(totalLine);
		const swapUsedBytes = swapLine === undefined ? null : swapUsedOf(swapLine);
		const swapOutBytes = swapOutBytesOf(vmStat.stdout);
		if (!isKernelLevel(kernelLevel) || !Number.isFinite(availablePercent) || !(totalBytes > 0) || swapUsedBytes === null || swapOutBytes === null) return unknownReading(at, previous);
		const elapsedMin = previous === null ? 0 : (at - previous.at) / 60_000;
		const swapOutBytesPerMin = previous === null || previous.pressure === "unknown" || elapsedMin <= 0 ? 0 : Math.max(0, swapOutBytes - previous.swapOutBytes) / elapsedMin;
		const raw = { kernelLevel, availablePercent, swapOutBytesPerMin };
		const before = previous?.pressure ?? "unknown";
		const calmer = before !== "unknown" && RANK[instantOf(raw)] < RANK[before];
		const calmTicks = calmer ? (previous?.calmTicks ?? 0) + 1 : 0;
		const pressure = pressureOf(raw, before, calmTicks);
		return {
			pressure,
			totalBytes,
			availableBytes: Math.round((totalBytes * availablePercent) / 100),
			swapUsedBytes,
			swapOutBytesPerMin: Math.round(swapOutBytesPerMin),
			swapOutBytes,
			calmTicks: pressure === before ? calmTicks : 0,
			at,
		};
	} catch {
		return unknownReading(at, previous);
	}
}
