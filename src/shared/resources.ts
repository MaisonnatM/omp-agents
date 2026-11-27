/** What the dashboard knows about this computer's memory and who holds it: the types the server and the Resources page share. */

/** How hard macOS presses on memory; `unknown` when it could not be read. */
export type Pressure = "normal" | "warn" | "critical" | "unknown";

/** One read of the computer's memory. */
export interface MemoryReading {
	pressure: Pressure;
	totalBytes: number;
	availableBytes: number;
	swapUsedBytes: number;
	swapOutBytesPerMin: number;
	/** Every byte macOS swapped out since it started, which the next read takes the rate from. */
	swapOutBytes: number;
	/** How many reads in a row were calmer than `pressure`; leaving warn or critical needs 2. */
	calmTicks: number;
	at: number;
}

/** Why an omp the roster does not list still runs. */
export type StrayReason = "unattached" | "orphan-port" | "foreign-live";

/** Who holds memory. */
export type Owner =
	| { kind: "session"; instanceId: string; title: string; private: boolean }
	/** `title` is that of the session file its omp holds open, as the Past list names it; `null` when none was found. */
	| { kind: "stray"; keeperId: string; port: number; reason: StrayReason; startedAt: number; title: string | null }
	| { kind: "mcp"; server: string; instanceId: string }
	/** One of a live session's jobs or services; `id` is what `PUT /api/session-processes/stop` takes. */
	| { kind: "process"; id: string; instanceId: string; label: string }
	| { kind: "heavy"; label: string; pid: number }
	| { kind: "dashboard"; part: "server" | "renderer" };

/** The memory one owner holds, and whether the Resources page can stop it. */
export interface Footprint {
	owner: Owner;
	memoryBytes: number;
	processCount: number;
	stoppable: boolean;
}

/** One stop the dashboard made without a click, and why. */
export interface AutoStop {
	owner: Owner;
	at: number;
	memoryBytes: number;
	because: "idle" | "stray" | Pressure;
}

/** What stops next if pressure rises, cheapest rung first. */
export interface LadderEntry {
	owner: Owner;
	rung: 0 | 1 | 2 | 3 | 4;
	memoryBytes: number;
}

/** Everything `GET /api/resources` answers. */
export interface ResourcesView {
	reading: MemoryReading | null;
	footprints: Footprint[];
	ladder: LadderEntry[];
	stops: AutoStop[];
}

/** One minute of history: the reading, the memory each owner class held, and the Jetsam events since the last sample. */
export interface ResourceSample {
	at: number;
	reading: MemoryReading;
	byClass: Record<Owner["kind"], number>;
	jetsam: { at: number; largestProcess: string; killed: number }[];
}
