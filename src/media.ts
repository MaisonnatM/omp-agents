/**
 * The images a transcript's tools returned, such as browser screenshots and `read`s of image files, and the image files
 * the session wrote that a tool call or its result named, such as a script's `page.png`, with those of its subagents at
 * any depth. Half the screenshots in a session sit in its subagents' files, so a view collects them all.
 * A named file counts as written when its modification time is at or after the start of the tree's own session, which
 * leaves out the paths that source code and old files mention; each path shows once across the tree, its oldest entry.
 */
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isObject, str } from "./json";
import { FoldedFile, ReadQueue } from "./line-reader";
import { expandHome } from "./paths";
import { entryTime, imagesOf, textOf, toolCallsOf, toolResultOf, toolSummary } from "./session-entries";
import { type AgentMedia, isVideoExtension, MEDIA_FILE_EXTENSIONS, mediaUrl, newestMediaFirst } from "./shared/transcript";
import { artifactsDir, subagentFiles } from "./subagents";

const IMAGE_EXTENSIONS = MEDIA_FILE_EXTENSIONS.filter(extension => !isVideoExtension(extension)).join("|");
/** Only a line holding a tool call, an image, a path to an image file, or the session header can add media; skipping the rest before `JSON.parse` keeps a session with many subagents cheap. */
const MARKERS = ['"type":"toolCall"', '"type":"image"', '"type":"session"'];
const IMAGE_NAME = new RegExp(String.raw`\.(?:${IMAGE_EXTENSIONS})\b`, "i");
/** An absolute, `~/`, or relative path to an image file in text, not part of a web address or of a longer name such as `shot.png.bak`. */
const IMAGE_PATH = new RegExp(String.raw`(?<![\w~./:-])(?:~\/|\.{0,2}\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)*\.(?:${IMAGE_EXTENSIONS})(?!\.?[\w/])`, "gi");
const IMAGE_FILE = new RegExp(String.raw`\.(?:${IMAGE_EXTENSIONS})$`, "i");
/** A tool result's call id, read without parsing the result, which can be large; omp writes `role` then `toolCallId` first. */
const RESULT_CALL_ID = /"role":"toolResult","toolCallId":"([^"\\]+)"/;

/** An image file a tool call or its result named, which the tree lists once it knows the session wrote it. */
type NamedFile = Omit<AgentMedia, "src" | "path"> & { path: string };

/** What a tool call told, by call id, until its result arrives. */
interface CallFacts {
	summary: string;
	/** The directory its relative paths resolve against: its own `cwd` argument, else the session's. */
	base: string | null;
	/** The image file a `read` opened; `null` for any other call. */
	read: string | null;
	/** The image files its arguments name; none for a `read`, whose image the result returns. */
	named: string[];
}

/** `path` absolute: as it is when absolute or `~/`, else against `base`; `null` for a relative path without one. */
function absolutePath(path: string, base: string | null): string | null {
	const expanded = expandHome(path);
	if (isAbsolute(expanded)) return resolve(expanded);
	return base === null ? null : resolve(base, expanded);
}

function imagePaths(text: string, base: string | null): string[] {
	return [...text.matchAll(IMAGE_PATH)].flatMap(([found]) => absolutePath(found, base) ?? []);
}

/** Every string in `value`, at any depth. */
function stringsOf(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringsOf);
	return isObject(value) ? Object.values(value).flatMap(stringsOf) : [];
}

/** One transcript's images and named image files, each oldest first. */
class MediaFold {
	readonly #agentId: string | null;
	readonly #calls = new Map<string, CallFacts>();
	/** The session's directory, from its header. */
	#cwd: string | null = null;
	/** When the session started, from its header, in ms since the epoch. */
	start: number | null = null;
	readonly media: AgentMedia[] = [];
	readonly named: NamedFile[] = [];

	constructor(agentId: string | null) {
		this.#agentId = agentId;
	}

	applyLine(line: string): void {
		if (!MARKERS.some(marker => line.includes(marker)) && !IMAGE_NAME.test(line)) {
			const callId = RESULT_CALL_ID.exec(line)?.[1];
			// A result naming nothing still lists the files its call named.
			if (callId === undefined || !this.#calls.get(callId)?.named.length) {
				if (callId) this.#calls.delete(callId);
				return;
			}
		}
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		if (!isObject(entry)) return;
		if (entry.type === "session") {
			this.start = entryTime(entry);
			const cwd = str(entry.cwd);
			this.#cwd = cwd && isAbsolute(cwd) ? cwd : null;
			return;
		}
		if (entry.type !== "message" || !isObject(entry.message)) return;
		for (const call of toolCallsOf(entry.message)) this.#calls.set(call.id, this.#factsOf(call.name, call.args, call.intent));
		const result = toolResultOf(entry.message);
		if (!result) return;
		const call = result.callId === undefined ? undefined : this.#calls.get(result.callId);
		if (result.callId) this.#calls.delete(result.callId);
		const summary = call?.summary ?? "";
		const at = entryTime(entry) ?? (typeof entry.message.timestamp === "number" ? entry.message.timestamp : 0);
		const facts = { agentId: this.#agentId, tool: result.toolName, summary, at };
		for (const src of imagesOf(result.content).images ?? []) this.media.push({ src, path: call?.read ?? null, ...facts });
		const named = new Set([...(call?.named ?? []), ...imagePaths(textOf(result.content), call?.base ?? this.#cwd)]);
		for (const path of named) this.named.push({ path, ...facts });
	}

	#factsOf(name: string, args: Record<string, unknown>, intent: string | undefined): CallFacts {
		const base = typeof args.cwd === "string" ? absolutePath(args.cwd, this.#cwd) : this.#cwd;
		const summary = toolSummary(args, intent);
		if (name !== "read") return { summary, base, read: null, named: stringsOf(args).flatMap(text => imagePaths(text, base)) };
		const path = typeof args.path === "string" && IMAGE_FILE.test(args.path) ? absolutePath(args.path, base) : null;
		return { summary, base, read: path, named: [] };
	}
}

/** Lists `a` and `b`, each ordered by {@link newestMediaFirst}, as one ordered list; an item equal to one of `a` follows it, as in a stable sort of `[...a, ...b]`. */
function merge(a: AgentMedia[], b: AgentMedia[]): AgentMedia[] {
	const merged: AgentMedia[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) merged.push(newestMediaFirst(b[j]!, a[i]!) < 0 ? b[j++]! : a[i++]!);
	while (i < a.length) merged.push(a[i++]!);
	while (j < b.length) merged.push(b[j++]!);
	return merged;
}

/** The images of transcript `path` and of every subagent transcript in its artifacts directory. */
export class MediaTree {
	readonly path: string;
	/** omp's lock sidecar beside the file, the only change a burst of appends can surface as on macOS. */
	readonly #lock: string;
	readonly #dir: string;
	readonly #own: FoldedFile<MediaFold>;
	/** Subagent transcripts by path, at any depth. */
	readonly #subagents = new Map<string, FoldedFile<MediaFold>>();
	readonly #emit: (reset: boolean, media: AgentMedia[]) => void;
	readonly #reads = new ReadQueue(() => this.#read());
	#media: AgentMedia[] = [];
	/** The paths of the files {@link #media} lists, each once. */
	readonly #paths = new Set<string>();
	/**
	 * Whether the session wrote each named file, by path, and when that was checked: a mention no newer than the check
	 * takes its verdict, and a later one checks again, since the session may have written the file since.
	 */
	readonly #checks = new Map<string, { at: number; written: Promise<boolean> }>();
	#loaded = false;
	#closed = false;
	/** Whether a change under the artifacts directory came since the last read, so the next one lists and reads the subagent files too; the first read does. */
	#subagentsChanged = true;

	/** `agentId` names the agent of `path` itself; `emit` gets the whole list once the first read finishes, then the images each later read added, or the whole list again after a file was rewritten. */
	constructor(path: string, agentId: string | null, emit: (reset: boolean, media: AgentMedia[]) => void) {
		this.path = path;
		this.#lock = join(dirname(path), `.${basename(path)}.lock`);
		this.#dir = artifactsDir(path);
		this.#own = new FoldedFile(path, () => new MediaFold(agentId));
		this.#emit = emit;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Ordered by {@link newestMediaFirst}. */
	get media(): AgentMedia[] {
		return this.#media;
	}

	/** Whether a change at `changedPath` can add to this tree: its file, that file's lock sidecar, or anything under its artifacts directory. */
	covers(changedPath: string): boolean {
		return changedPath === this.path || changedPath === this.#lock || changedPath.startsWith(`${this.#dir}/`);
	}

	/** Read what the change at `changedPath` appended: the tree's own file, and the subagent files when it is under the artifacts directory. */
	poke(changedPath: string): void {
		if (this.#closed) return;
		if (changedPath !== this.path && changedPath !== this.#lock) this.#subagentsChanged = true;
		this.#reads.poke();
	}

	/** Stops emitting: a read still in flight and every later poke are ignored, and the files read so far are released. */
	close(): void {
		this.#closed = true;
		this.#subagents.clear();
		this.#media = [];
		this.#paths.clear();
		this.#checks.clear();
	}

	async #read(): Promise<void> {
		const subagents = this.#subagentsChanged;
		this.#subagentsChanged = false;
		if (subagents) {
			for (const path of await subagentFiles(this.path)) {
				if (!this.#subagents.has(path)) this.#subagents.set(path, new FoldedFile(path, () => new MediaFold(basename(path, ".jsonl"))));
			}
		}
		const files = subagents ? [this.#own, ...this.#subagents.values()] : [this.#own];
		// Each file's images and named files it added, or `null` when it was rewritten and they start over.
		const reads = await Promise.all(
			files.map(async file => {
				const media = file.fold.media.length;
				const named = file.fold.named.length;
				const { restarted } = await file.read();
				return restarted ? null : { media: file.fold.media.slice(media), named: file.fold.named.slice(named) };
			}),
		);
		if (this.#closed) return;
		if (this.#loaded && !reads.includes(null)) {
			const added = await this.#admit(
				reads.flatMap(read => read?.media ?? []),
				reads.flatMap(read => read?.named ?? []),
			);
			if (this.#closed || added.length === 0) return;
			this.#media = merge(this.#media, added);
			this.#emit(false, added);
			return;
		}
		const folds = [this.#own, ...this.#subagents.values()].map(file => file.fold);
		this.#paths.clear();
		const media = await this.#admit(
			folds.flatMap(fold => fold.media),
			folds.flatMap(fold => fold.named),
		);
		if (this.#closed) return;
		this.#loaded = true;
		this.#media = media;
		this.#emit(true, media);
	}

	/**
	 * `returned` and the `named` files the session wrote, as entries newest first, each path once: its oldest entry here,
	 * and none for a path the list already holds.
	 */
	async #admit(returned: AgentMedia[], named: NamedFile[]): Promise<AgentMedia[]> {
		const fresh = named.filter(file => !this.#paths.has(file.path));
		const written = await Promise.all(fresh.map(file => this.#written(file)));
		const files = fresh.filter((_, index) => written[index]).map((file): AgentMedia => ({ ...file, src: mediaUrl(file.path) }));
		return [...returned, ...files]
			.sort((a, b) => a.at - b.at)
			.filter(item => {
				if (item.path === null) return true;
				if (this.#paths.has(item.path)) return false;
				this.#paths.add(item.path);
				return true;
			})
			.sort(newestMediaFirst);
	}

	/** Whether the session wrote `file`: a regular file modified at or after the tree's own session started. */
	#written(file: NamedFile): Promise<boolean> {
		const checked = this.#checks.get(file.path);
		if (checked && checked.at >= file.at) return checked.written;
		const start = this.#own.fold.start;
		if (start === null) return Promise.resolve(false);
		const written = stat(file.path).then(
			found => found.isFile() && found.mtimeMs >= start,
			() => false,
		);
		this.#checks.set(file.path, { at: Date.now(), written });
		return written;
	}
}
