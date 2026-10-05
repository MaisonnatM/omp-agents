/**
 * The images a transcript's tools returned, such as browser screenshots and `read`s of image files, with those of its
 * subagents at any depth. Half the screenshots in a session sit in its subagents' files, so a view collects them all.
 */
import { basename, dirname, join } from "node:path";
import { isObject } from "./json";
import { LineReader, ReadQueue } from "./line-reader";
import { entryTime, imagesOf, toolCallsOf, toolResultOf, toolSummary } from "./session-entries";
import type { AgentMedia } from "./shared";
import { artifactsDir, subagentFiles } from "./subagents";

/** Only a line holding a tool call or an image can add media; skipping the rest before `JSON.parse` keeps a session with many subagents cheap. */
const MARKERS = ['"type":"toolCall"', '"type":"image"'];
/** A tool result's call id, read without parsing the result, which can be large; omp writes `role` then `toolCallId` first. */
const RESULT_CALL_ID = /"role":"toolResult","toolCallId":"([^"\\]+)"/;

/** One transcript's images, oldest first. */
class MediaFile {
	readonly #agentId: string | null;
	readonly #lines: LineReader;
	/** What each tool call said it did, by call id, until its result arrives. */
	readonly #summaries = new Map<string, string>();
	media: AgentMedia[] = [];
	#rewritten = false;

	constructor(path: string, agentId: string | null) {
		this.#agentId = agentId;
		this.#lines = new LineReader(path, () => {
			this.media = [];
			this.#summaries.clear();
			this.#rewritten = true;
		});
	}

	/** Reads what was appended since the last read; resolves whether its images changed. */
	async read(): Promise<boolean> {
		const before = this.media.length;
		this.#rewritten = false;
		await this.#lines.read(line => this.#apply(line));
		return this.#rewritten || this.media.length !== before;
	}

	#apply(line: string): void {
		if (!MARKERS.some(marker => line.includes(marker))) {
			const callId = RESULT_CALL_ID.exec(line)?.[1];
			if (callId) this.#summaries.delete(callId);
			return;
		}
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		if (!isObject(entry) || entry.type !== "message" || !isObject(entry.message)) return;
		for (const call of toolCallsOf(entry.message)) this.#summaries.set(call.id, toolSummary(call.args, call.intent));
		const result = toolResultOf(entry.message);
		if (!result) return;
		const summary = (result.callId && this.#summaries.get(result.callId)) || "";
		if (result.callId) this.#summaries.delete(result.callId);
		const images = imagesOf(result.content).images;
		if (!images) return;
		const at = entryTime(entry) ?? (typeof entry.message.timestamp === "number" ? entry.message.timestamp : 0);
		for (const src of images) this.media.push({ src, agentId: this.#agentId, tool: result.toolName, summary, at });
	}
}

/** The images of transcript `path` and of every subagent transcript in its artifacts directory. */
export class MediaTree {
	readonly path: string;
	/** omp's lock sidecar beside the file, the only change a burst of appends can surface as on macOS. */
	readonly #lock: string;
	readonly #dir: string;
	readonly #files = new Map<string, MediaFile>();
	readonly #emit: (media: AgentMedia[]) => void;
	readonly #reads = new ReadQueue(() => this.#read());
	#media: AgentMedia[] = [];
	#loaded = false;

	/** `agentId` names the agent of `path` itself; `emit` gets the whole list once the first read finishes, then after each read that changes it. */
	constructor(path: string, agentId: string | null, emit: (media: AgentMedia[]) => void) {
		this.path = path;
		this.#lock = join(dirname(path), `.${basename(path)}.lock`);
		this.#dir = artifactsDir(path);
		this.#files.set(path, new MediaFile(path, agentId));
		this.#emit = emit;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Newest first. */
	get media(): AgentMedia[] {
		return this.#media;
	}

	/** Whether a change at `changedPath` can add to this tree: its file, that file's lock sidecar, or anything under its artifacts directory. */
	covers(changedPath: string): boolean {
		return changedPath === this.path || changedPath === this.#lock || changedPath.startsWith(`${this.#dir}/`);
	}

	/** Read what every file appended since the last read, and look for new subagent files. */
	poke(): void {
		this.#reads.poke();
	}

	async #read(): Promise<void> {
		for (const path of await subagentFiles(this.path)) {
			if (!this.#files.has(path)) this.#files.set(path, new MediaFile(path, basename(path, ".jsonl")));
		}
		let changed = false;
		for (const file of this.#files.values()) if (await file.read()) changed = true;
		if (this.#loaded && !changed) return;
		this.#loaded = true;
		this.#media = [...this.#files.values()].flatMap(file => file.media).sort((a, b) => b.at - a.at);
		this.#emit(this.#media);
	}
}
