/** What a session's Browser can load: the addresses its jobs and services listen on, and the one it opens on. */
import type { LiveSessionProcesses } from "../src/shared/processes";
import { isLoopbackUrl } from "../src/shared/desktop-bridge";

/** An address the Browser offers for a session: a port one of its jobs or services listens on. */
export interface BrowserCandidate {
	url: string;
	/** The job's command line or the service's name, as the CPU card shows it. */
	label: string;
	port: number;
}

/**
 * Every port session `instanceId`'s own jobs and services listen on, biggest process first as the CPU card lists them.
 * A shared broker daemon, such as omp's browser, serves every session and is not the session's app.
 */
export function browserCandidates(sessions: readonly LiveSessionProcesses[] | null, instanceId: string): BrowserCandidate[] {
	const session = sessions?.find(listed => listed.instanceId === instanceId);
	return (session?.processes ?? []).flatMap(running =>
		running.shared ? [] : running.ports.map(port => ({ url: `http://localhost:${port}/`, label: running.label, port })),
	);
}

/** The address the Browser opens on: the one last loaded for the session, else the first candidate, else none. */
export const initialAddress = (saved: string | null, candidates: readonly BrowserCandidate[]): string | null =>
	saved !== null && isLoopbackUrl(saved) ? saved : (candidates[0]?.url ?? null);

export interface Point {
	x: number;
	y: number;
}

/** An area of the Browser's page, in its CSS pixels from the top left. */
export interface Area extends Point {
	width: number;
	height: number;
}

/** A drag shorter than this either way is a click, which captures the whole page, as a click on a window does in macOS's screenshot. */
const CLICK_SLOP = 4;

/** The area a drag from `from` to `to` covers on a `width` by `height` page, kept inside it, or `null` for a click. */
export function dragArea(from: Point, to: Point, width: number, height: number): Area | null {
	if (Math.abs(to.x - from.x) < CLICK_SLOP && Math.abs(to.y - from.y) < CLICK_SLOP) return null;
	const clampX = (x: number): number => Math.min(Math.max(x, 0), width);
	const clampY = (y: number): number => Math.min(Math.max(y, 0), height);
	const left = clampX(Math.min(from.x, to.x));
	const top = clampY(Math.min(from.y, to.y));
	return { x: left, y: top, width: clampX(Math.max(from.x, to.x)) - left, height: clampY(Math.max(from.y, to.y)) - top };
}
