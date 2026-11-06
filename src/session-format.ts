import type { UsageFiles } from "./foreign/usage";
import type { SavedSession } from "./omp/sessions";
import type { SessionSource } from "./shared/sessions";

export interface SessionFormat {
	source: SessionSource;
	/** The directory the agent writes its session files under. */
	root: string;
	/** Whether the dashboard makes {@link root} when it is missing; it never writes into another agent's directory. */
	createRoot: boolean;
	/** The session file a watcher event at `changedPath` under {@link root} is about, or `null` for anything else. */
	fileOf(changedPath: string): string | null;
	/** Every session file the agent keeps; none while {@link root} does not exist. */
	list(): Promise<SavedSession[]>;
	/** One file as {@link list} gives it; `null` when it is gone or holds no session to list. */
	read(path: string): Promise<SavedSession | null>;
	/** One line of a session file as omp entries; a line the reader does not know becomes an unread-line entry. Never throws. */
	decode(line: string): unknown[];
	/** The lines that can hold a prompt or a reply, so conversation search leaves the rest, most of a file's bytes, unparsed. */
	messageLine: RegExp;
	/** The transcripts that record the agent's requests; omp's have none here, since omp-stats indexes them. */
	usage?: UsageFiles;
}
