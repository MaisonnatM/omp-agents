/**
 * The page's activity recorder: which view is shown, which command and action ran, and which tagged control was clicked,
 * by registry id only, kept in an outbox in `localStorage` until the server acknowledges it.
 */
import { fields, isSafeInteger, isString, parseJson } from "../src/json";
import { ACTION_MESSAGES, type ActivityEvent, type ActivityKind, type ActivityVia, type ControlId, isActivityEvent, MAX_ACTIVITY_BATCH } from "../src/shared/activity";
import type { ClientMsg } from "../src/shared/protocol";
import type { DashboardState } from "./dashboard-state";
import type { Layout, Page, SettingsSection, SidebarTab } from "./routing";

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
	/** Whether a batch sent now reaches the server; while it does not, the outbox keeps every batch. */
	connected(): boolean;
	/** Sends one batch, settling once the server has stored it and rejecting when it refused it. */
	send(batch: ActivityBatch): Promise<void>;
	/** A browser under automation records nothing, so an agent's smoke run never counts as use. */
	automated: boolean;
}

export interface Recorder {
	record(kind: ActivityKind, key: string, via?: ActivityVia | null): void;
	/** Sends every contiguous run in the outbox, at most {@link MAX_ACTIVITY_BATCH} events each. */
	flush(): Promise<void>;
	/** Saves the outbox to storage if it changed since the last save, as when the page hides or unloads. */
	persist(): void;
}

const isPendingEvent = fields<PendingEvent>({ client: isString, seq: isSafeInteger, event: isActivityEvent });

/** The kept outbox, without any entry the server would refuse, such as one an older version kept. */
function loadOutbox(storage: Storage | null): PendingEvent[] {
	const kept = parseJson(storage?.getItem(OUTBOX_STORAGE_KEY) ?? "[]");
	return Array.isArray(kept) ? kept.filter(isPendingEvent) : [];
}

/** The outbox's runs of one page load's consecutive events, at most {@link MAX_ACTIVITY_BATCH} each. */
function batchesOf(outbox: readonly PendingEvent[]): PendingEvent[][] {
	const batches: PendingEvent[][] = [];
	for (const pending of outbox) {
		const last = batches.at(-1);
		const tail = last?.at(-1);
		if (last && tail && tail.client === pending.client && tail.seq + 1 === pending.seq && last.length < MAX_ACTIVITY_BATCH) last.push(pending);
		else batches.push([pending]);
	}
	return batches;
}

/**
 * A recorder for one page load, under a fresh client id, which first resends what earlier loads left in the outbox.
 * It saves the outbox as a flush starts, after each batch the server took, and on {@link Recorder.persist}, not on each event.
 */
export function createRecorder({ now, storage, connected, send, automated }: RecorderEnv): Recorder {
	const client = crypto.randomUUID();
	let seq = 0;
	let outbox = loadOutbox(storage);
	let dirty = false;
	let sending = false;
	const persist = (): void => {
		if (!dirty) return;
		dirty = false;
		try {
			storage?.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(outbox));
		} catch {
			// A full or blocked storage keeps the outbox in memory only.
		}
	};
	const drop = (batch: readonly PendingEvent[]): void => {
		const gone = new Set(batch);
		outbox = outbox.filter(pending => !gone.has(pending));
		dirty = true;
		persist();
	};
	return {
		record(kind, key, via = null) {
			if (automated) return;
			const event: ActivityEvent = { kind, key, via, at: now() };
			// An event the server would refuse would cost its whole batch, so it is never kept.
			if (!isActivityEvent(event)) return;
			outbox.push({ client, seq: seq++, event });
			if (outbox.length > MAX_OUTBOX) outbox = outbox.slice(-MAX_OUTBOX);
			dirty = true;
		},
		async flush() {
			persist();
			if (sending || outbox.length === 0) return;
			sending = true;
			try {
				for (const batch of batchesOf(outbox)) {
					// Offline, every batch waits for the next flush; a batch the server refused is dropped, so it never holds back the rest.
					if (!connected()) return;
					const [{ client: batchClient, seq: first }] = batch as [PendingEvent];
					await send({ t: "activity", client: batchClient, first, events: batch.map(({ event }) => event) }).catch(() => {});
					drop(batch);
				}
			} finally {
				sending = false;
			}
		},
		persist,
	};
}

let installed: Recorder | null = null;

/** Records an event on the page's recorder; before {@link installActivity}, as in tests, it records nothing. */
export function record(kind: ActivityKind, key: string, via: ActivityVia | null = null): void {
	installed?.record(kind, key, via);
}

/** Records `msg` as an action when {@link ACTION_MESSAGES} says it is the user's. */
export function recordAction(msg: ClientMsg): void {
	if (ACTION_MESSAGES[msg.t]) record("action", msg.t);
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

/** The id of the control a click on `target` hits: the nearest element tagged by {@link activityControl}, if any. */
export function controlOf(target: EventTarget | null): string | null {
	return typeof Element !== "undefined" && target instanceof Element ? (target.closest("[data-activity]")?.getAttribute("data-activity") ?? null) : null;
}

/** Records a click inside any element tagged by {@link activityControl}, with one listener for the whole document. */
export function listenForControls(doc: Pick<Document, "addEventListener" | "removeEventListener">, recordControl: (id: string) => void): () => void {
	const onClick = (event: Event): void => {
		const id = controlOf(event.target);
		if (id) recordControl(id);
	};
	doc.addEventListener("click", onClick, { capture: true });
	return () => doc.removeEventListener("click", onClick, { capture: true });
}

/**
 * Every view but the settings sections, which {@link ViewKey} adds: the panes by how many there are and of what kind, and
 * each page by its kind and whether it shows one item, never an id or a path. `tab` is the sidebar tab a view goes with,
 * so Settings › Activity sets apart a view whose tab's service omp is not signed in to.
 */
export const VIEWS = [
	{ key: "home", label: "Home" },
	{ key: "session", label: "A session" },
	{ key: "past", label: "A past session" },
	{ key: "split", label: "Split panes" },
	{ key: "pull-requests", label: "Pull requests" },
	{ key: "pull-requests/item", label: "A pull request" },
	{ key: "pull-requests/files", label: "A pull request's files" },
	{ key: "tickets", label: "Tickets", tab: "tickets" },
	{ key: "tickets/item", label: "A ticket", tab: "tickets" },
	{ key: "todo", label: "Todo" },
	{ key: "todo/item", label: "A todo" },
	{ key: "notes", label: "Notes" },
	{ key: "notes/item", label: "A note" },
	{ key: "calendar", label: "Calendar" },
	{ key: "routines", label: "Routines" },
	{ key: "routines/item", label: "A routine" },
	{ key: "bots", label: "New Bot" },
	{ key: "bots/item", label: "A Bot" },
	{ key: "inbox", label: "Inbox", tab: "inbox" },
	{ key: "inbox/new", label: "New mail", tab: "inbox" },
	{ key: "inbox/item", label: "A mail conversation", tab: "inbox" },
	{ key: "scheduled", label: "Scheduled sends" },
	{ key: "scheduled/item", label: "A scheduled send" },
	{ key: "new", label: "New session" },
] as const satisfies readonly { key: string; label: string; tab?: SidebarTab }[];

/** A view's key: one of {@link VIEWS}, or a settings section. */
export type ViewKey = (typeof VIEWS)[number]["key"] | `settings/${SettingsSection}`;

function pageView(page: Page): ViewKey {
	switch (page.kind) {
		case "settings":
			return `settings/${page.section}`;
		case "pull-requests":
			return page.target === null ? "pull-requests" : page.files === null ? "pull-requests/item" : "pull-requests/files";
		case "tickets":
			return page.target === null ? "tickets" : "tickets/item";
		case "routines":
			return page.target === null ? "routines" : "routines/item";
		case "bots":
			return page.target === null ? "bots" : "bots/item";
		case "todo":
			return page.open === null ? "todo" : "todo/item";
		case "notes":
			return page.open === null ? "notes" : "notes/item";
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
export function viewOf(cover: DashboardState["cover"], layout: Pick<Layout, "panes">): ViewKey {
	if (cover?.kind === "page") return pageView(cover.page);
	if (cover?.kind === "session") return "session";
	if (layout.panes.length === 0) return "home";
	if (layout.panes.length > 1) return "split";
	return layout.panes[0]!.kind === "live" ? "session" : "past";
}

/**
 * Installs the page's recorder: presence when the tab hides, shows, or loses focus, clicks on tagged controls, a flush
 * every {@link FLUSH_MS} and when the tab hides, and a save of the outbox as the page unloads. Returns the uninstall.
 */
export function installActivity({ connected, send }: Pick<RecorderEnv, "connected" | "send">): () => void {
	const recorder = createRecorder({ now: Date.now, storage: globalThis.localStorage ?? null, connected, send, automated: navigator.webdriver === true });
	installed = recorder;
	const onVisibility = (): void => {
		recorder.record("presence", document.visibilityState === "hidden" ? "background" : "foreground");
		if (document.visibilityState === "hidden") void recorder.flush();
	};
	const onPageHide = (): void => recorder.persist();
	const onFocus = (): void => recorder.record("presence", "foreground");
	const onBlur = (): void => recorder.record("presence", "background");
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("focus", onFocus);
	window.addEventListener("blur", onBlur);
	window.addEventListener("pagehide", onPageHide);
	const stopControls = listenForControls(document, id => recorder.record("control", id));
	const timer = setInterval(() => void recorder.flush(), FLUSH_MS);
	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("focus", onFocus);
		window.removeEventListener("blur", onBlur);
		window.removeEventListener("pagehide", onPageHide);
		recorder.persist();
		stopControls();
		clearInterval(timer);
		if (installed === recorder) installed = null;
	};
}
