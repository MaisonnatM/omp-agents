/** What the page records of how its user uses it, by registry id only, and the Settings › Activity answer. */
import { arrayOf, decoder, fields, type Guard, isNumber, isObject, isSafeInteger, isString, oneOf } from "../json";
import { ANALYTICS_RANGES, type AnalyticsRange } from "./analytics";
import type { ClientMsg } from "./protocol";

/** A page or settings section shown, a shortcut run, a socket message or `PUT` sent, a tagged control clicked, or the window coming to the foreground or leaving it. */
export const ACTIVITY_KINDS = ["view", "command", "action", "control", "presence"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** How a command ran: its shortcut's key, or the command palette. */
export const ACTIVITY_VIAS = ["keyboard", "palette"] as const;

export type ActivityVia = (typeof ACTIVITY_VIAS)[number];

/** One thing the user did, at `at` ms. `key` is a registry id, never user content; `via` is set on commands only. */
export interface ActivityEvent {
	kind: ActivityKind;
	key: string;
	via: ActivityVia | null;
	at: number;
}

/** The `presence` keys. */
export type Presence = "foreground" | "background";

/** What a key may hold: lowercase ids, route paths, and spaces, so a title, a path under `/Users/`, or an identifier such as `ENG-12` never passes. */
export const ACTIVITY_KEY = /^[a-z0-9][a-z0-9/._ -]{0,79}$/;

const isKind = oneOf(ACTIVITY_KINDS);
const isVia = oneOf(ACTIVITY_VIAS);

/** An event the server stores: a known kind, a key {@link ACTIVITY_KEY} allows, a `via` on a command only, and a time in ms. The socket's parser and the page's kept outbox both check with it. */
export const isActivityEvent: Guard<ActivityEvent> = (value): value is ActivityEvent =>
	isObject(value) &&
	isKind(value.kind) &&
	typeof value.key === "string" &&
	ACTIVITY_KEY.test(value.key) &&
	isSafeInteger(value.at) &&
	value.at >= 0 &&
	(value.kind === "command" ? isVia(value.via) : value.via === null);

/** The one id of a feature across the fold, the inventory, and the reconcile script. */
export const featureId = (kind: ActivityKind, key: string): string => `${kind}:${key}`;

/**
 * The controls only the page sees, which no view, command, or action observes, by id: lowercase and dotted, `<part>.<what>`.
 * A component tags each with `activityControl(id)` from `web/activity.ts`; `area` groups them in Settings › Activity.
 */
export const CONTROLS = [
	{ id: "get-started.dismiss", label: "Get started dismissed on this computer", area: "Get started" },
	{ id: "get-started.refresh", label: "Get started checked again", area: "Get started" },
	{ id: "get-started.install-kit", label: "Get started starter kit installation", area: "Get started" },
	{ id: "get-started.copy-command", label: "Get started command copied", area: "Get started" },
	{ id: "get-started.install-gh", label: "Get started GitHub CLI installation link", area: "Get started" },
	{ id: "get-started.next", label: "Get started step continued", area: "Get started" },
	{ id: "get-started.back", label: "Get started step back", area: "Get started" },
	{ id: "get-started.skip", label: "Get started step skipped", area: "Get started" },
	{ id: "get-started.step", label: "Get started step picked from its list", area: "Get started" },
	{ id: "get-started.suggestion", label: "Get started first-session suggestion", area: "Get started" },
	{ id: "get-started.close", label: "Get started closed into its bubble", area: "Get started" },
	{ id: "get-started.bubble", label: "Get started reopened from its bubble", area: "Get started" },
	{ id: "trajectory.toggle", label: "Trajectory toggle", area: "Panes" },
	{ id: "trajectory.turn", label: "Trajectory turn, folded or unfolded", area: "Panes" },
	{ id: "trajectory.step", label: "Trajectory step, folded or unfolded", area: "Panes" },
	{ id: "replay.open", label: "Replay from here", area: "Panes" },
	{ id: "replay-compare.open", label: "Compare replay", area: "Panes" },
	{ id: "minimap.jump", label: "Minimap turn", area: "Transcript" },
	{ id: "minimap.step", label: "Minimap previous or next turn", area: "Transcript" },
	{ id: "prompt-history.toggle", label: "Chat history button", area: "Transcript" },
	{ id: "prompt-history.jump", label: "Chat history prompt", area: "Transcript" },
	{ id: "transcript.activity-group", label: "Tool calls group, folded or unfolded", area: "Transcript" },
	{ id: "transcript.routine-card", label: "Routine run card, folded or unfolded", area: "Transcript" },
	{ id: "transcript.scroll-to-bottom", label: "Scroll-to-bottom arrow", area: "Transcript" },
	{ id: "transcript.todos", label: "Todos card, folded or unfolded", area: "Transcript" },
	{ id: "transcript.ship", label: "Todos card's Ship section, folded or unfolded", area: "Transcript" },
	{ id: "media-viewer.open", label: "Image opened large", area: "Transcript" },
	{ id: "media-viewer.step", label: "Image viewer previous or next", area: "Transcript" },
	{ id: "media-viewer.new-tab", label: "Image viewer, open in a new tab", area: "Transcript" },
	{ id: "file-dialog.open", label: "File path in agent text", area: "Transcript" },
	{ id: "file-dialog.source", label: "File dialog, source or rendered", area: "Transcript" },
	{ id: "file-dialog.copy-path", label: "File dialog, copy the path", area: "Transcript" },
	{ id: "ask-about.open", label: "Ask about this", area: "Transcript" },
	{ id: "discussion.close", label: "Discussion panel close", area: "Transcript" },
	{ id: "composer.directory", label: "Directory picker", area: "Composer" },
	{ id: "composer.branch", label: "Branch picker", area: "Composer" },
	{ id: "composer.model", label: "Model and effort menu", area: "Composer" },
	{ id: "composer.context-ring", label: "Context ring", area: "Composer" },
	{ id: "completion.pick", label: "Slash or mention menu pick", area: "Composer" },
	{ id: "composer-suggestions.pick", label: "Suggested prompt", area: "Composer" },
	{ id: "composer-suggestions.send-all", label: "Suggested prompts, all of them", area: "Composer" },
	{ id: "composer-queue.send-now", label: "Queued message, send now", area: "Composer" },
	{ id: "composer-queue.edit", label: "Queued message, edit", area: "Composer" },
	{ id: "composer-queue.remove", label: "Queued message, remove", area: "Composer" },
	{ id: "changes-card.files.fold", label: "Todos card Files section, folded or unfolded", area: "Changes" },
	{ id: "changes-card.images.fold", label: "Todos card Images section, folded or unfolded", area: "Changes" },
	{ id: "changes-card.review", label: "Todos card Review", area: "Changes" },
	{ id: "changes-card.file", label: "Todos card file", area: "Changes" },
	{ id: "changes-card.image.select", label: "Todos card image selected", area: "Changes" },
	{ id: "changes-card.image.clear", label: "Todos card image selection cleared", area: "Changes" },
	{ id: "changes-card.image.to-pull-request", label: "Todos card images, pull request menu", area: "Changes" },
	{ id: "changes-card.image.to-ticket", label: "Todos card images, Linear issue menu", area: "Changes" },
	{ id: "changes-card.sources.fold", label: "Todos card Sources section, folded or unfolded", area: "Changes" },
	{ id: "changes-card.source", label: "Todos card source opened", area: "Changes" },
	{ id: "changes-dialog.scope.all", label: "Session changes, All changes tab", area: "Changes" },
	{ id: "changes-dialog.scope.session", label: "Session changes, This session tab", area: "Changes" },
	{ id: "changes-dialog.refresh", label: "Session changes, read again", area: "Changes" },
	{ id: "sidebar.left.toggle", label: "Left sidebar toggle", area: "Sidebar" },
	{ id: "sidebar.right.toggle", label: "Right sidebar toggle", area: "Sidebar" },
	{ id: "sidebar.workspace", label: "Sidebar workspace picker", area: "Sidebar" },
	{ id: "shortcuts.open", label: "Keyboard shortcuts button", area: "Sidebar" },
	{ id: "shortcuts.tab", label: "Keyboard shortcuts category tab", area: "Sidebar" },
	{ id: "calendar.routines.toggle", label: "Calendar routine visibility", area: "Calendar" },
	{ id: "bots.delete", label: "Bot Delete, before it is confirmed", area: "Bots" },
	{ id: "bots.details", label: "Bot details sidebar, shown or hidden from its name", area: "Bots" },
	{ id: "bots.job.revert", label: "Bot job edit reverted", area: "Bots" },
	{ id: "bots.kind", label: "New Bot type", area: "Bots" },
	{ id: "bots.job.template", label: "New Bot job template", area: "Bots" },
	{ id: "bots.look", label: "Bot shape and color picker", area: "Bots" },
	{ id: "bots.routine.delete", label: "Bot routine Delete, before it is confirmed", area: "Bots" },
	{ id: "bots.routine.new", label: "Bot New routine", area: "Bots" },
	{ id: "bots.routine.run", label: "Bot routine run, picked on its strip", area: "Bots" },
	{ id: "bots.tab.details", label: "Bot details Details tab", area: "Bots" },
	{ id: "header.back", label: "Back button", area: "Header" },
	{ id: "header.command-menu", label: "Command menu button", area: "Header" },
	{ id: "header.forward", label: "Forward button", area: "Header" },
	{ id: "header.settings", label: "Settings button", area: "Header" },
	{ id: "header.tab", label: "Notes, Calendar, and Email buttons", area: "Header" },
	{ id: "header.whats-new", label: "What's new button", area: "Header" },
	{ id: "notices.open", label: "Notification bell", area: "Notifications" },
	{ id: "notices.filter", label: "Notifications source filter", area: "Notifications" },
	{ id: "notices.read-all", label: "Notifications, mark all as read", area: "Notifications" },
	{ id: "notices.item", label: "Notification", area: "Notifications" },
	{ id: "notices.update", label: "Notification Update button", area: "Notifications" },
	{ id: "notices.clear", label: "Notification cleared", area: "Notifications" },
	{ id: "session-details.tab.pull-requests", label: "Session details PRs tab", area: "Right sidebar" },
	{ id: "session-details.tab.browser", label: "Session details Browser tab", area: "Right sidebar" },
	{ id: "session-details.tab.tickets", label: "Session details Tickets tab", area: "Right sidebar" },
	{ id: "browser.back", label: "Browser back", area: "Browser" },
	{ id: "browser.forward", label: "Browser forward", area: "Browser" },
	{ id: "browser.reload", label: "Browser reload", area: "Browser" },
	{ id: "browser.server", label: "Browser dev server menu", area: "Browser" },
	{ id: "browser.start-server", label: "Browser Start dev server", area: "Browser" },
	{ id: "browser.stop-server", label: "Browser Stop dev server", area: "Browser" },
	{ id: "browser.select-element", label: "Browser Pick in the app", area: "Browser" },
	{ id: "browser.screenshot", label: "Browser Screenshot", area: "Browser" },
	{ id: "browser.review-visuals", label: "Browser Review visuals", area: "Browser" },
	{ id: "browser.pick.select", label: "Browser pick mode Select", area: "Browser" },
	{ id: "browser.pick.region", label: "Browser pick mode Region", area: "Browser" },
	{ id: "browser.pick.draw", label: "Browser pick mode Draw", area: "Browser" },
	{ id: "browser.pick.erase", label: "Browser pick mode Erase", area: "Browser" },
	{ id: "browser.annotation.attach", label: "Browser annotation Attach", area: "Browser" },
	{ id: "browser.maximize", label: "Browser Maximize", area: "Browser" },
	{ id: "browser.open-in-browser", label: "Browser Open in default browser", area: "Browser" },
	{ id: "browser.tab", label: "Browser tab", area: "Browser" },
	{ id: "pull-requests.view.list", label: "Pull requests list view", area: "Pull requests" },
	{ id: "pull-requests.view.board", label: "Pull requests board view", area: "Pull requests" },
	{ id: "pr-details.tab.summary", label: "Pull request Summary tab", area: "Pull requests" },
	{ id: "pr-details.tab.timeline", label: "Pull request Timeline tab", area: "Pull requests" },
	{ id: "pr-details.tab.code", label: "Pull request Code tab", area: "Pull requests" },
	{ id: "pr-details.tab.review", label: "Pull request Review draft tab", area: "Pull requests" },
	{ id: "pr-details.checkout", label: "Check out menu", area: "Pull requests" },
	{ id: "status-bar.terminal", label: "Terminal button", area: "Status bar" },
	{ id: "status-bar.cpu", label: "CPU card", area: "Status bar" },
] as const satisfies readonly { id: string; label: string; area: string }[];

export type ControlId = (typeof CONTROLS)[number]["id"];

/** The most events one `activity` message carries. */
export const MAX_ACTIVITY_BATCH = 500;

/** One stored event: page load `client`'s `seq`th. */
export interface ActivityRow extends ActivityEvent {
	client: string;
	seq: number;
}

/** One feature's use over the range. */
export interface ActivityUse {
	kind: ActivityKind;
	key: string;
	count: number;
	/** Distinct local days it was used on. */
	days: number;
	lastAt: number;
	/** For commands, how many ran by key and from the palette; zero otherwise. */
	keyboard: number;
	palette: number;
}

/** One local day's foreground time, visits, and actions. */
export interface ActivityDay {
	/** `YYYY-MM-DD` in the server's time zone. */
	day: string;
	activeMs: number;
	/** Runs of events with no gap of 30 minutes or more. */
	visits: number;
	actions: number;
}

/** A feature's last use, whatever the range. */
export interface ActivityLastUse {
	kind: ActivityKind;
	key: string;
	at: number;
}

/** What `foldActivity` answers over the range's rows. */
export interface ActivityFold {
	uses: ActivityUse[];
	/** Moves from one view to the next within one page load, most first. */
	transitions: { from: string; to: string; count: number }[];
	/** Foreground time per view, most first. */
	dwell: { view: string; ms: number }[];
	days: ActivityDay[];
}

/** `GET /api/activity?range=`. */
export interface ActivityRead extends ActivityFold {
	range: AnalyticsRange;
	/** Every feature's last use, whatever the range, so a feature unused in range still shows when it was last used. */
	lastUsed: ActivityLastUse[];
	/** Every `PUT` route key, for the inventory. */
	serverActions: string[];
}

/** A kept {@link ActivityRead}, or `null` for one an older version kept. */
export const decodeActivity = decoder(
	fields<ActivityRead>({
		range: oneOf(ANALYTICS_RANGES),
		uses: arrayOf(fields<ActivityUse>({ kind: isKind, key: isString, count: isNumber, days: isNumber, lastAt: isNumber, keyboard: isNumber, palette: isNumber })),
		lastUsed: arrayOf(fields<ActivityLastUse>({ kind: isKind, key: isString, at: isNumber })),
		transitions: arrayOf(fields<ActivityFold["transitions"][number]>({ from: isString, to: isString, count: isNumber })),
		dwell: arrayOf(fields<ActivityFold["dwell"][number]>({ view: isString, ms: isNumber })),
		days: arrayOf(fields<ActivityDay>({ day: isString, activeMs: isNumber, visits: isNumber, actions: isNumber })),
		serverActions: arrayOf(isString),
	}),
);

/**
 * Which socket messages are the user's actions, recorded as `action` with the message's `t` as key. A message the page
 * sends on its own, such as `watch`, `read`, a notice marked seen, or `activity` itself, is not one.
 */
export const ACTION_MESSAGES: Record<ClientMsg["t"], boolean> = {
	watch: false,
	prompt: true,
	dequeue: true,
	promote: true,
	interrupt: true,
	flush: true,
	"edit-prompt": true,
	complete: false,
	end: true,
	read: false,
	start: true,
	"resume-all": true,
	"dismiss-interrupted": true,
	"rename-session": true,
	"list-models": false,
	"set-model": true,
	"set-thinking": true,
	"set-fast": true,
	answer: true,
	"cancel-agent": true,
	"user-todo": true,
	"user-note": true,
	routine: true,
	bot: true,
	schedule: true,
	pin: true,
	preference: true,
	"review-draft": true,
	notice: false,
	discuss: true,
	"discuss-stop": true,
	activity: false,
};
