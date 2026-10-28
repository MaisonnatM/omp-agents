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

/** A drag shorter than this either way is a click, which marks no region. */
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

/** What Region and Draw leave on the Browser's page until **Attach**: a box, or a freehand line, with the area it covers. */
export type Mark = { kind: "region"; id: number; area: Area } | { kind: "stroke"; id: number; points: Point[]; area: Area };

/** The width of a Draw line, in the page's CSS pixels. */
export const STROKE_WIDTH = 4;

/** The smallest area holding every one of `areas`, grown by `margin` and kept inside a `width` by `height` page, or `null` for none. */
export function unionArea(areas: readonly Area[], margin: number, width: number, height: number): Area | null {
	if (areas.length === 0) return null;
	const left = Math.max(0, Math.min(...areas.map(area => area.x)) - margin);
	const top = Math.max(0, Math.min(...areas.map(area => area.y)) - margin);
	const right = Math.min(width, Math.max(...areas.map(area => area.x + area.width)) + margin);
	const bottom = Math.min(height, Math.max(...areas.map(area => area.y + area.height)) + margin);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The area a line through `points` covers, its width included. */
export function strokeArea(points: readonly Point[]): Area {
	const half = STROKE_WIDTH / 2;
	const xs = points.map(point => point.x);
	const ys = points.map(point => point.y);
	const x = Math.min(...xs) - half;
	const y = Math.min(...ys) - half;
	return { x, y, width: Math.max(...xs) + half - x, height: Math.max(...ys) + half - y };
}

/** The mark Erase removes at `point`: the last drawn of those whose area holds it. */
export const markAt = (marks: readonly Mark[], point: Point): Mark | null =>
	marks.findLast(({ area }) => point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height) ?? null;

/**
 * Where the comment card of `size` goes beside the marks covering `bounds` on a `width` by `height` page, as T3 Code
 * places it: right of them, else left, else below, else above, whichever spills least, then kept inside the page.
 */
export function cardPlace(bounds: Area, size: { width: number; height: number }, width: number, height: number): Point {
	const gap = 8;
	const candidates: Point[] = [
		{ x: bounds.x + bounds.width + gap, y: bounds.y },
		{ x: bounds.x - size.width - gap, y: bounds.y },
		{ x: bounds.x + bounds.width - size.width, y: bounds.y + bounds.height + gap },
		{ x: bounds.x + bounds.width - size.width, y: bounds.y - size.height - gap },
	];
	const spill = ({ x, y }: Point): number =>
		Math.max(0, -x) + Math.max(0, -y) + Math.max(0, x + size.width - width) + Math.max(0, y + size.height - height);
	const best = candidates.reduce((current, candidate) => (spill(candidate) < spill(current) ? candidate : current));
	return {
		x: Math.min(Math.max(gap, best.x), Math.max(gap, width - size.width - gap)),
		y: Math.min(Math.max(gap, best.y), Math.max(gap, height - size.height - gap)),
	};
}
