/** Setup facts owned by omp and the starter kit installer, without checklist copy or saved completion. */
export type CollabAutoStart = "off" | "view" | "control";

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
