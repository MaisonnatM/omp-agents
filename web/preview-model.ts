/** What a session's Preview can load: the addresses its jobs and services listen on, and the one it opens on. */
import type { LiveSessionProcesses } from "../src/shared/processes";
import { isLoopbackUrl } from "../src/shared/desktop-bridge";

/** An address the Preview offers for a session: a port one of its jobs or services listens on. */
export interface PreviewCandidate {
	url: string;
	/** The job's command line or the service's name, as the CPU card shows it. */
	label: string;
	port: number;
}

/**
 * Every port session `instanceId`'s own jobs and services listen on, biggest process first as the CPU card lists them.
 * A shared broker daemon, such as omp's browser, serves every session and is not the session's app.
 */
export function previewCandidates(sessions: readonly LiveSessionProcesses[] | null, instanceId: string): PreviewCandidate[] {
	const session = sessions?.find(listed => listed.instanceId === instanceId);
	return (session?.processes ?? []).flatMap(running =>
		running.shared ? [] : running.ports.map(port => ({ url: `http://localhost:${port}/`, label: running.label, port })),
	);
}

/** The address the Preview opens on: the one last loaded for the session, else the first candidate, else none. */
export const initialAddress = (saved: string | null, candidates: readonly PreviewCandidate[]): string | null =>
	saved !== null && isLoopbackUrl(saved) ? saved : (candidates[0]?.url ?? null);
