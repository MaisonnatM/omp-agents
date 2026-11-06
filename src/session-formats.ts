import { claudeCodeFormat } from "./foreign/claude-code";
import { codexFormat } from "./foreign/codex";
import { parseJson } from "./json";
import { listSessionFiles, readSessionFile, sessionFileOf, sessionsDir } from "./omp/sessions";
import type { SessionFormat } from "./session-format";

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
