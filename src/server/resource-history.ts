/**
 * The Resources page's history: one {@link ResourceSample} a minute in a JSON Lines file per UTC day under
 * `~/.config/omp-agents/resources/`, kept 14 days, and the Jetsam events macOS reported, read from its diagnostic reports.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "../json";
import type { ResourceSample } from "../shared/resources";

/** How long a day's file is kept. */
export const HISTORY_DAYS = 14;
const DAY_MS = 86_400_000;
/** How often a sample is kept: the watch ticks every 15 seconds, the history keeps one a minute. */
const SAMPLE_MS = 60_000;

/** Where macOS writes its Jetsam reports, readable without root. */
export const DIAGNOSTIC_REPORTS_DIR = "/Library/Logs/DiagnosticReports";

type JetsamEvent = ResourceSample["jetsam"][number];

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const JETSAM_FILE = /^JetsamEvent-.*\.ips$/;

/** `2026-11-24 11:43:55.00 +0100`, a report header's `timestamp`, as epoch milliseconds; `NaN` for any other shape. */
function timestampOf(text: string): number {
	const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) ([+-]\d{2})(\d{2})$/.exec(text);
	return match ? Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`) : Number.NaN;
}

/** A Jetsam report's event: its time from the header line, and from the body the largest process and how many processes macOS killed for memory, not for being idle. */
function jetsamOf(report: string): JetsamEvent | null {
	const newline = report.indexOf("\n");
	if (newline < 0) return null;
	const header: unknown = JSON.parse(report.slice(0, newline));
	const at = isObject(header) && typeof header.timestamp === "string" ? timestampOf(header.timestamp) : Number.NaN;
	if (Number.isNaN(at)) return null;
	const body: unknown = JSON.parse(report.slice(newline + 1));
	if (!isObject(body)) return null;
	const processes = Array.isArray(body.processes) ? body.processes : [];
	const killed = processes.filter(process => isObject(process) && typeof process.reason === "string" && process.reason !== "idle-exit").length;
	return { at, largestProcess: typeof body.largestProcess === "string" ? body.largestProcess : "", killed };
}

export class ResourceHistory {
	readonly #dir: string;
	readonly #reportsDir: string;
	readonly #now: () => number;
	/** The day the last append wrote, so old days are pruned once a day. */
	#day: string | null = null;
	/** Each Jetsam report read, by file name, `null` for one that would not parse; reports never change. */
	readonly #reports = new Map<string, JetsamEvent | null>();
	/** When the last kept sample was taken; `undefined` until the first record reads it from disk. */
	#lastAt: number | null | undefined;

	constructor(dir: string, { reportsDir = DIAGNOSTIC_REPORTS_DIR, now = Date.now }: { reportsDir?: string; now?: () => number } = {}) {
		this.#dir = dir;
		this.#reportsDir = reportsDir;
		this.#now = now;
	}

	/**
	 * Keeps `sample` when a minute passed since the last kept one, with the Jetsam events since it, or since a minute
	 * before `sample` when none is kept; the process watch calls it every tick.
	 */
	async record(sample: ResourceSample): Promise<void> {
		if (this.#lastAt === undefined) this.#lastAt = (await this.read(24)).at(-1)?.at ?? null;
		if (this.#lastAt !== null && sample.at - this.#lastAt < SAMPLE_MS) return;
		const jetsam = (await this.jetsamSince(this.#lastAt ?? sample.at - SAMPLE_MS)).filter(event => event.at <= sample.at);
		this.#lastAt = sample.at;
		this.append({ ...sample, jetsam });
	}

	/** Adds `sample` to its day's file, and on the first append of a day deletes the files older than {@link HISTORY_DAYS}. */
	append(sample: ResourceSample): void {
		const day = dayOf(sample.at);
		if (day !== this.#day) {
			mkdirSync(this.#dir, { recursive: true });
			this.#prune();
			this.#day = day;
		}
		appendFileSync(join(this.#dir, `${day}.jsonl`), `${JSON.stringify(sample)}\n`);
	}

	/** The samples of the last `hours`, oldest first, skipping a line that does not parse. */
	async read(hours: number): Promise<ResourceSample[]> {
		const now = this.#now();
		const since = now - hours * 3_600_000;
		const days = this.#days().filter(day => day >= dayOf(since) && day <= dayOf(now));
		const samples: ResourceSample[] = [];
		for (const day of days) {
			const text = await readFile(join(this.#dir, `${day}.jsonl`), "utf8").catch(() => "");
			for (const line of text.split("\n")) {
				if (!line) continue;
				try {
					const sample: unknown = JSON.parse(line);
					if (isObject(sample) && typeof sample.at === "number" && sample.at >= since && sample.at <= now) samples.push(sample as unknown as ResourceSample);
				} catch {
					// A line cut short by a crash mid-append.
				}
			}
		}
		return samples.sort((a, b) => a.at - b.at);
	}

	/** The Jetsam events after `at`, oldest first; a report it cannot read or parse, or a reports folder it cannot list, adds none. */
	async jetsamSince(at: number): Promise<JetsamEvent[]> {
		let names: string[];
		try {
			names = readdirSync(this.#reportsDir).filter(name => JETSAM_FILE.test(name));
		} catch {
			return [];
		}
		const events: JetsamEvent[] = [];
		for (const name of names) {
			if (!this.#reports.has(name)) {
				const report = await readFile(join(this.#reportsDir, name), "utf8").catch(() => null);
				if (report === null) continue;
				try {
					this.#reports.set(name, jetsamOf(report));
				} catch {
					this.#reports.set(name, null);
				}
			}
			const event = this.#reports.get(name);
			if (event && event.at > at) events.push(event);
		}
		return events.sort((a, b) => a.at - b.at);
	}

	/** The days that have a file, oldest first. */
	#days(): string[] {
		try {
			return readdirSync(this.#dir).flatMap(name => DAY_FILE.exec(name)?.[1] ?? []).sort();
		} catch {
			return [];
		}
	}

	#prune(): void {
		const oldest = dayOf(this.#now() - HISTORY_DAYS * DAY_MS);
		for (const day of this.#days()) if (day < oldest) rmSync(join(this.#dir, `${day}.jsonl`), { force: true });
	}
}
