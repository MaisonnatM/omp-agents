/** The load of the machine the dashboard runs on, as the window's status bar shows it. */
export interface SystemLoad {
	/** Percent of every core's time spent busy since the previous read, `null` until time has passed. */
	cpuPercent: number | null;
	/** Bytes the system can hand out without swapping. */
	memoryAvailable: number;
	/** Bytes of physical memory. */
	memoryTotal: number;
}
