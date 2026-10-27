/**
 * The images a transcript's tools returned, such as browser screenshots and `read`s of image files, and the image files
 * the session wrote that a tool call or its result named, such as a script's `page.png`, with those of its subagents at
 * any depth. Half the screenshots in a session sit in its subagents' files, so a view collects them all.
 * A named file counts as written when its modification time is at or after the start of the tree's own session, which
 * leaves out the paths that source code and old files mention; each path shows once across the tree, its oldest entry.
 * The same read collects the tree's sources: the web pages and remote items its tools opened, each URL once, its oldest entry.
 */
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isObject, str } from "./json";
import { FoldedFile, ReadQueue } from "./line-reader";
import { expandHome } from "./paths";
import { entryTime, imagesOf, textOf, toolCallsOf, toolResultOf, toolSummary } from "./session-entries";
import { type AgentMedia, type AgentSource, isVideoExtension, MEDIA_FILE_EXTENSIONS, mediaUrl, newestMediaFirst } from "./shared/transcript";
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
/** A host that serves only this computer, such as a dev server, whose pages are no source. */
const LOOPBACK = /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1?\])$/;
/** A GitHub pull request or issue omp's `read` opens: `pr://owner/repo/N` or `issue://owner/repo/N`, with any subpath. */
const GITHUB_ITEM = /^(pr|issue):\/\/([\w.-]+)\/([\w.-]+)\/(\d+)(?:[/?#]|$)/;
/** A URL a browser `open`, `goto`, or `navigate` call in `eval` code takes, as a string or an object's `url`. */
const BROWSER_URL = /\b(?:open|goto|navigate)\(\s*(?:\{[^}]*?\burl\s*:\s*)?["'`](https?:\/\/[^"'`\s]+)["'`]/g;
const ANY_URL = /https?:\/\/[^\s"'`<>()[\]]+/g;
/** An MCP tool that reads, by the verb after its server's name, as `mcp__sentry_get_sentry_resource` or `mcp__slack_read_thread`. */
const MCP_READ = /mcp__[a-z\d]+_(?:get|read|fetch|find|analyze)_/;

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
	/** The web addresses it opens, which count once it succeeds. */
	sources: string[];
}

/** `raw` as an `http:` or `https:` address off this computer, as the URL parser writes it; `null` for any other. */
function webUrl(raw: string): string | null {
	const url = URL.parse(raw.replace(/[.,;:!?]+$/, ""));
	return url && (url.protocol === "http:" || url.protocol === "https:") && !LOOPBACK.test(url.hostname) ? url.href : null;
}

/** The addresses tool call `name` opens with `args`: a `read` of a URL or a GitHub item, a fetch, a browser page, or a URL an MCP read names. */
function sourcesOf(name: string, args: Record<string, unknown>): string[] {
	const urls = (texts: string[], pattern: RegExp, group = 0): string[] => texts.flatMap(text => [...text.matchAll(pattern)].flatMap(match => webUrl(match[group]!) ?? []));
	if (name === "read") {
		if (typeof args.path !== "string") return [];
		const item = GITHUB_ITEM.exec(args.path);
		if (item) return [`https://github.com/${item[2]}/${item[3]}/${item[1] === "pr" ? "pull" : "issues"}/${item[4]}`];
		const url = webUrl(args.path);
		return url ? [url] : [];
	}
	if (name === "web_fetch" || name === "fetch" || name === "browser") return typeof args.url === "string" ? urls([args.url], ANY_URL) : [];
	if (name === "eval") return typeof args.code === "string" ? urls([args.code], BROWSER_URL, 1) : [];
	if (MCP_READ.test(name)) return urls(stringsOf(args), ANY_URL);
	if (name === "write" && typeof args.path === "string" && MCP_READ.test(args.path)) return urls(stringsOf(args.content), ANY_URL);
	return [];
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
	readonly sources: AgentSource[] = [];

	constructor(agentId: string | null) {
		this.#agentId = agentId;
	}

	applyLine(line: string): void {
		if (!MARKERS.some(marker => line.includes(marker)) && !IMAGE_NAME.test(line)) {
			const callId = RESULT_CALL_ID.exec(line)?.[1];
			// A result naming nothing still lists the files its call named, and the sources its call opened.
			const pending = callId === undefined ? undefined : this.#calls.get(callId);
			if (!pending?.named.length && !pending?.sources.length) {
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
		if (!result.isError) for (const url of new Set(call?.sources)) this.sources.push({ url, ...facts });
	}

	#factsOf(name: string, args: Record<string, unknown>, intent: string | undefined): CallFacts {
		const base = typeof args.cwd === "string" ? absolutePath(args.cwd, this.#cwd) : this.#cwd;
		const summary = toolSummary(args, intent);
		const sources = sourcesOf(name, args);
		if (name !== "read") return { summary, base, read: null, named: stringsOf(args).flatMap(text => imagePaths(text, base)), sources };
		const path = typeof args.path === "string" && IMAGE_FILE.test(args.path) ? absolutePath(args.path, base) : null;
		return { summary, base, read: path, named: [], sources };
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

/** The images and sources of transcript `path` and of every subagent transcript in its artifacts directory. */
export class MediaTree {
	readonly path: string;
	/** omp's lock sidecar beside the file, the only change a burst of appends can surface as on macOS. */
	readonly #lock: string;
	readonly #dir: string;
	readonly #own: FoldedFile<MediaFold>;
	/** Subagent transcripts by path, at any depth. */
	readonly #subagents = new Map<string, FoldedFile<MediaFold>>();
	readonly #emit: (reset: boolean, media: AgentMedia[], sources: AgentSource[]) => void;
	readonly #reads = new ReadQueue(() => this.#read());
	#media: AgentMedia[] = [];
	/** The paths of the files {@link #media} lists, each once. */
	readonly #paths = new Set<string>();
	/** Oldest first, each URL once. */
	#sources: AgentSource[] = [];
	/** The URLs {@link #sources} lists. */
	readonly #urls = new Set<string>();
	/**
	 * Whether the session wrote each named file, by path, and when that was checked: a mention no newer than the check
	 * takes its verdict, and a later one checks again, since the session may have written the file since.
	 */
	readonly #checks = new Map<string, { at: number; written: Promise<boolean> }>();
	#loaded = false;
	#closed = false;
	/** Whether a change under the artifacts directory came since the last read, so the next one lists and reads the subagent files too; the first read does. */
	#subagentsChanged = true;

	/**
	 * `agentId` names the agent of `path` itself; `emit` gets the whole lists once the first read finishes, then the images
	 * and sources each later read added, or the whole lists again after a file was rewritten.
	 */
	constructor(path: string, agentId: string | null, emit: (reset: boolean, media: AgentMedia[], sources: AgentSource[]) => void) {
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

	/** Oldest first. */
	get sources(): AgentSource[] {
		return this.#sources;
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
		this.#sources = [];
		this.#urls.clear();
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
		// Each file's images, named files, and sources it added, or `null` when it was rewritten and they start over.
		const reads = await Promise.all(
			files.map(async file => {
				const media = file.fold.media.length;
				const named = file.fold.named.length;
				const sources = file.fold.sources.length;
				const { restarted } = await file.read();
				return restarted ? null : { media: file.fold.media.slice(media), named: file.fold.named.slice(named), sources: file.fold.sources.slice(sources) };
			}),
		);
		if (this.#closed) return;
		if (this.#loaded && !reads.includes(null)) {
			const added = await this.#admit(
				reads.flatMap(read => read?.media ?? []),
				reads.flatMap(read => read?.named ?? []),
			);
			if (this.#closed) return;
			const sources = this.#admitSources(reads.flatMap(read => read?.sources ?? []));
			if (added.length === 0 && sources.length === 0) return;
			this.#media = merge(this.#media, added);
			this.#sources = [...this.#sources, ...sources];
			this.#emit(false, added, sources);
			return;
		}
		const folds = [this.#own, ...this.#subagents.values()].map(file => file.fold);
		this.#paths.clear();
		const media = await this.#admit(
			folds.flatMap(fold => fold.media),
			folds.flatMap(fold => fold.named),
		);
		if (this.#closed) return;
		this.#urls.clear();
		this.#loaded = true;
		this.#media = media;
		this.#sources = this.#admitSources(folds.flatMap(fold => fold.sources));
		this.#emit(true, media, this.#sources);
	}

	/** `sources` oldest first, each URL once: its oldest entry here, and none for a URL the list already holds. */
	#admitSources(sources: AgentSource[]): AgentSource[] {
		return sources
			.sort((a, b) => a.at - b.at)
			.filter(source => {
				if (this.#urls.has(source.url)) return false;
				this.#urls.add(source.url);
				return true;
			});
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
