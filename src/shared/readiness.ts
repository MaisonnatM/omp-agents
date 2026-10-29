/** Setup facts owned by omp and the starter kit installer, without checklist copy or saved completion. */
export type CollabAutoStart = "off" | "view" | "control";
/** The terminal publishing a person can choose on Get started; turning it off stays in omp's own settings. */
export type TerminalAccess = Exclude<CollabAutoStart, "off">;
export const isTerminalAccess = (value: unknown): value is TerminalAccess => value === "view" || value === "control";

export type ReadinessFact<T> = { kind: "known"; value: T } | { kind: "unavailable"; message: string };

export interface Readiness {
	providers: ReadinessFact<number>;
	collabAutoStart: ReadinessFact<CollabAutoStart>;
}

/** A non-forced installer plan. Customized files and settings count as present. */
export interface StarterKitStatus {
	pending: number;
	kept: number;
	total: number;
}
