/**
 * The agents whose session files the dashboard lists: omp's, which it resumes and forks, and Claude Code's and
 * Codex's, which it only reads. A format names where an agent keeps its files, lists them, and decodes each line into
 * the omp entries the transcript folds read, so everything past the reader sees omp's shape.
 */
import { claudeCodeFormat } from "./foreign/claude-code";
import { codexFormat } from "./foreign/codex";
import { parseJson } from "./json";
import { listSessionFiles, readSessionFile, type SavedSession, sessionFileOf, sessionsDir } from "./omp/sessions";
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
}

/** omp's sessions under `root`, its sessions directory, one directory per working directory. */
export const ompFormat = (root: string): SessionFormat => ({
	source: "omp",
	root,
	createRoot: true,
	fileOf: path => sessionFileOf(path, root),
	list: () => listSessionFiles(root),
	read: readSessionFile,
	decode: line => {
		const entry = parseJson(line);
		return entry === undefined ? [] : [entry];
	},
	messageLine: /"role":"(?:user|assistant)"|"type":"custom_message"/,
});

const OMP_FORMAT = ompFormat(sessionsDir);

export const SESSION_FORMATS: readonly SessionFormat[] = [OMP_FORMAT, claudeCodeFormat(), codexFormat()];

/** The format of the session file at `path`: the one whose root holds it, else omp's, as a subagent's file outside every root reads. */
export const formatOf = (path: string, formats: readonly SessionFormat[] = SESSION_FORMATS): SessionFormat =>
	formats.find(format => path.startsWith(`${format.root}/`)) ?? OMP_FORMAT;
