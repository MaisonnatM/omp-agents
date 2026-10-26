/**
 * The page's activity recorder: which view is shown, which command and action ran, and which tagged control was clicked,
 * by registry id only, kept in an outbox in `localStorage` until the server acknowledges it.
 */
import { ACTIVITY_KEY, type ActivityEvent, type ActivityKind, type ActivityVia, type ControlId, MAX_ACTIVITY_BATCH } from "../src/shared/activity";
import type { DashboardState } from "./dashboard-state";
import type { Layout, Page } from "./routing";

/** The outbox's `localStorage` key; it keeps what earlier page loads have not yet sent. */
export const OUTBOX_STORAGE_KEY = "omp-agents.activity-outbox";
/** The most events the outbox keeps; past it the oldest go first. */
export const MAX_OUTBOX = 5000;
/** How often the recorder sends what it holds. */
const FLUSH_MS = 10_000;

/** An event waiting to reach the server, numbered within its page load. */
export interface PendingEvent {
	client: string;
	seq: number;
	event: ActivityEvent;
}

/** The `activity` message a batch goes out as. */
export interface ActivityBatch {
	t: "activity";
	client: string;
	first: number;
	events: ActivityEvent[];
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export interface RecorderEnv {
	now(): number;
	storage: Storage | null;
	/** Sends one batch, settling once the server has stored it. */
	send(batch: ActivityBatch): Promise<void>;
	/** A browser under automation records nothing, so an agent's smoke run never counts as use. */
	automated: boolean;
}

export interface Recorder {
	record(kind: ActivityKind, key: string, via?: ActivityVia | null): void;
	/** Sends every contiguous run in the outbox, at most {@link MAX_ACTIVITY_BATCH} events each. */
	flush(): Promise<void>;
}

function loadOutbox(storage: Storage | null): PendingEvent[] {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(OUTBOX_STORAGE_KEY) ?? "[]");
		return Array.isArray(parsed) ? (parsed as PendingEvent[]) : [];
	} catch {
		return [];
	}
}

/** A recorder for one page load, under a fresh client id, which first resends what earlier loads left in the outbox. */
export function createRecorder({ now, storage, send, automated }: RecorderEnv): Recorder {
	const client = crypto.randomUUID();
	let seq = 0;
	let outbox = loadOutbox(storage);
	let sending = false;
	const save = (): void => {
		try {
			storage?.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(outbox));
		} catch {
			// A full or blocked storage keeps the outbox in memory only.
		}
	};
	return {
		record(kind, key, via = null) {
			// A key the server would refuse would cost the whole batch, so it is never kept.
			if (automated || !ACTIVITY_KEY.test(key)) return;
			outbox.push({ client, seq: seq++, event: { kind, key, via, at: now() } });
			if (outbox.length > MAX_OUTBOX) outbox = outbox.slice(-MAX_OUTBOX);
			save();
		},
		async flush() {
			if (sending || outbox.length === 0) return;
			sending = true;
			try {
				const batches: PendingEvent[][] = [];
				for (const pending of outbox) {
					const last = batches.at(-1);
					const tail = last?.at(-1);
					if (last && tail && tail.client === pending.client && tail.seq + 1 === pending.seq && last.length < MAX_ACTIVITY_BATCH) last.push(pending);
					else batches.push([pending]);
				}
				for (const batch of batches) {
					const [{ client: batchClient, seq: first }] = batch as [PendingEvent];
					await send({ t: "activity", client: batchClient, first, events: batch.map(({ event }) => event) });
					const sent = new Set(batch);
					outbox = outbox.filter(pending => !sent.has(pending));
					save();
				}
			} catch {
				// Not connected, or the server refused: the outbox keeps the rest for the next flush.
			} finally {
				sending = false;
			}
		},
	};
}

let installed: Recorder | null = null;

/** Records an event on the page's recorder; before {@link installActivity}, as in tests, it records nothing. */
export function record(kind: ActivityKind, key: string, via: ActivityVia | null = null): void {
	installed?.record(kind, key, via);
}

/** Sends what the page's recorder holds, as on a socket's open. */
export function flushActivity(): void {
	void installed?.flush();
}

/** A shortcut or palette command's key: its shortcut id in kebab case (`newSession` is `new-session`). */
export function commandKey(id: string): string {
	return id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

/** The tag that makes a click on a page-only control count, by its id in `CONTROLS`. */
export function activityControl(id: ControlId): { "data-activity": ControlId } {
	return { "data-activity": id };
}

interface ControlTarget {
	closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** Records a click inside any element tagged by {@link activityControl}, with one listener for the whole document. */
export function listenForControls(doc: Pick<Document, "addEventListener" | "removeEventListener">, recordControl: (id: string) => void): () => void {
	const onClick = (event: Event): void => {
		const target = event.target as Partial<ControlTarget> | null;
		const id = target?.closest?.("[data-activity]")?.getAttribute("data-activity");
		if (id) recordControl(id);
	};
	doc.addEventListener("click", onClick, { capture: true });
	return () => doc.removeEventListener("click", onClick, { capture: true });
}

/** The view a page names, by its kind and whether it shows one item; never an id or a path. */
function pageView(page: Page): string {
	switch (page.kind) {
		case "settings":
			return `settings/${page.section}`;
		case "pull-requests":
			return page.target === null ? "pull-requests" : page.files === null ? "pull-requests/item" : "pull-requests/files";
		case "tickets":
		case "routines":
			return page.target === null ? page.kind : `${page.kind}/item`;
		case "todo":
		case "notes":
			return page.open === null ? page.kind : `${page.kind}/item`;
		case "projects":
			return page.target.kind === "list" ? "projects" : page.target.kind === "new" ? "projects/new" : "projects/item";
		case "inbox":
			return page.target === null ? "inbox" : page.target === "new" ? "inbox/new" : "inbox/item";
		case "scheduled":
			return page.id === null ? "scheduled" : "scheduled/item";
		case "calendar":
		case "new":
			return page.kind;
	}
}

/** The view the page shows: the covering page, or the panes by how many there are and of what kind. */
export function viewOf(cover: DashboardState["cover"], layout: Pick<Layout, "panes">): string {
	if (cover?.kind === "page") return pageView(cover.page);
	if (cover?.kind === "session") return "session";
	if (layout.panes.length === 0) return "home";
	if (layout.panes.length > 1) return "split";
	return layout.panes[0]!.kind === "live" ? "session" : "past";
}

/**
 * Installs the page's recorder: presence when the tab hides, shows, or loses focus, clicks on tagged controls, and a flush
 * every {@link FLUSH_MS} and when the tab hides. Returns the uninstall.
 */
export function installActivity(send: RecorderEnv["send"]): () => void {
	const recorder = createRecorder({ now: Date.now, storage: globalThis.localStorage ?? null, send, automated: navigator.webdriver === true });
	installed = recorder;
	const onVisibility = (): void => {
		recorder.record("presence", document.visibilityState === "hidden" ? "background" : "foreground");
		if (document.visibilityState === "hidden") void recorder.flush();
	};
	const onFocus = (): void => recorder.record("presence", "foreground");
	const onBlur = (): void => recorder.record("presence", "background");
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("focus", onFocus);
	window.addEventListener("blur", onBlur);
	const stopControls = listenForControls(document, id => recorder.record("control", id));
	const timer = setInterval(() => void recorder.flush(), FLUSH_MS);
	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("focus", onFocus);
		window.removeEventListener("blur", onBlur);
		stopControls();
		clearInterval(timer);
		if (installed === recorder) installed = null;
	};
}
