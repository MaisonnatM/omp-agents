/** Pure transforms from server messages to what the page renders. */
import type {
	AgentRow,
	CatalogModel,
	InboxPullRequest,
	Item,
	OmpFile,
	OmpFileKind,
	PastSession,
	PullRequest,
	RosterHost,
	View,
} from "../src/shared";

export type ToolItem = Extract<Item, { kind: "tool" }>;

/** Consecutive tool calls render as one activity group between messages. */
export type Block = { kind: "item"; item: Exclude<Item, ToolItem> } | { kind: "tools"; id: string; tools: ToolItem[] };

export interface AgentNode {
	agent: AgentRow;
	/** 0 for subagents of the main agent, 1 for their children, and so on. */
	depth: number;
}

const PAST_PREFIX = "past/";
const SETTINGS = "settings";
const INBOX = "inbox";
const SESSION_PREFIX = "session/";
const NEW = "new";

/** The inbox page, and the pull request whose row it scrolls to and highlights; `null` for none. */
export interface InboxRoute {
	target: PullRequest | null;
}

/**
 * `#inbox` opens the inbox page, which lists the pull requests of the sidebar's project, and
 * `#inbox/<owner>/<repo>/<number>` opens it at that pull request's row. Any other `#inbox/…` opens the page alone.
 */
export function inboxFromHash(hash: string): InboxRoute | null {
	const raw = hash.replace(/^#/, "");
	if (raw !== INBOX && !raw.startsWith(`${INBOX}/`)) return null;
	const match = /^inbox\/([\w.-]+)\/([\w.-]+)\/(\d+)$/.exec(raw);
	return { target: match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null };
}

export const hashForInbox = (target: PullRequest | null): string =>
	target ? `#${INBOX}/${target.owner}/${target.repo}/${target.number}` : `#${INBOX}`;

/** `#session/<id>` names a session by its id, which outlives the host running it, for links from outside the page. */
export function sessionFromHash(hash: string): string | null {
	const raw = hash.replace(/^#/, "");
	return raw.startsWith(SESSION_PREFIX) && raw.length > SESSION_PREFIX.length ? decodeURIComponent(raw.slice(SESSION_PREFIX.length)) : null;
}

/** The view a session id opens: the live host that runs the session, else its saved transcript. */
export function viewForSession(sessionId: string, hosts: RosterHost[]): View {
	const host = hosts.find(h => h.sessionId === sessionId);
	return host ? { kind: "live", instanceId: host.instanceId, agentId: null } : { kind: "past", sessionId };
}

/** Where the settings page reads project files and config from; `null` for user-level only. */
export interface SettingsRoute {
	cwd: string | null;
}

/** `#settings` opens the settings page, `#settings/<cwd>` with that workspace's project files and config. */
export function settingsFromHash(hash: string): SettingsRoute | null {
	const raw = hash.replace(/^#/, "");
	if (raw === SETTINGS) return { cwd: null };
	return raw.startsWith(`${SETTINGS}/`) ? { cwd: decodeURIComponent(raw.slice(SETTINGS.length + 1)) } : null;
}

export const hashForSettings = (cwd: string | null): string =>
	cwd === null ? `#${SETTINGS}` : `#${SETTINGS}/${encodeURIComponent(cwd)}`;

/** The directory a new session starts in, as typed or displayed (`~/code/webapp`); `null` for {@link defaultCwd}. */
export interface NewSessionRoute {
	cwd: string | null;
}

/** `#new` opens the new-session draft, `#new/<cwd>` with that directory chosen. No omp runs until its first message. */
export function newSessionFromHash(hash: string): NewSessionRoute | null {
	const raw = hash.replace(/^#/, "");
	if (raw === NEW) return { cwd: null };
	return raw.startsWith(`${NEW}/`) ? { cwd: decodeURIComponent(raw.slice(NEW.length + 1)) } : null;
}

export const hashForNewSession = (cwd: string | null): string => (cwd === null ? `#${NEW}` : `#${NEW}/${encodeURIComponent(cwd)}`);

/** Panes the page splits into at most, as a 2x2 grid. */
export const MAX_PANES = 4;

/** The views on screen in grid order, and the focused one that plain clicks, new sessions, and forks open into. */
export interface Layout {
	/** Distinct views, at most {@link MAX_PANES}. */
	panes: View[];
	/** Index into `panes`; 0 when there are none. */
	focus: number;
	/** The focused pane fills the page with the others kept behind it; only ever true with 2+ panes. */
	maximized: boolean;
}

export const EMPTY_LAYOUT: Layout = { panes: [], focus: 0, maximized: false };

export const focusedView = (layout: Layout): View | null => layout.panes[layout.focus] ?? null;

/** `<instanceId>` for a live session, `<instanceId>/<agentId>` for one of its subagents, `past/<sessionId>` for a past session. */
function paneForView(view: View): string {
	if (view.kind === "past") return `${PAST_PREFIX}${encodeURIComponent(view.sessionId)}`;
	const session = encodeURIComponent(view.instanceId);
	return view.agentId === null ? session : `${session}/${encodeURIComponent(view.agentId)}`;
}

/** Instance ids are hex, so none reads as `past`, `settings`, `inbox`, `session`, or `new`. */
function viewFromPane(pane: string): View {
	if (pane.startsWith(PAST_PREFIX)) return { kind: "past", sessionId: decodeURIComponent(pane.slice(PAST_PREFIX.length)) };
	const slash = pane.indexOf("/");
	if (slash < 0) return { kind: "live", instanceId: decodeURIComponent(pane), agentId: null };
	return {
		kind: "live",
		instanceId: decodeURIComponent(pane.slice(0, slash)),
		agentId: decodeURIComponent(pane.slice(slash + 1)),
	};
}

export const hashForView = (view: View): string => `#${paneForView(view)}`;

export const sameView = (a: View | null, b: View | null): boolean =>
	(a && paneForView(a)) === (b && paneForView(b));

const MAXIMIZED = ";max";

/**
 * `#<pane>` for one pane, so single-view links from before split screen still open; `#<pane>,<pane>…@<focus>`
 * for more, with `@<focus>` left out when the first pane has focus, then `;max` when the focused pane is maximized.
 * Encoded ids hold no `,`, `@`, or `;`.
 */
export function hashForLayout({ panes, focus, maximized }: Layout): string {
	if (panes.length === 0) return "";
	return `#${panes.map(paneForView).join(",")}${focus > 0 ? `@${focus}` : ""}${maximized ? MAXIMIZED : ""}`;
}

/**
 * The layout a hash names, keeping the first {@link MAX_PANES} distinct views and focus on the view it named.
 * `null` for the settings, inbox, and new-session pages, which leave the panes behind them alone, and for a
 * `#session/<id>` link, which names no layout until the session lists show where that session runs.
 */
export function layoutFromHash(hash: string): Layout | null {
	if (settingsFromHash(hash) || inboxFromHash(hash) || newSessionFromHash(hash) || sessionFromHash(hash) !== null) return null;
	const marked = hash.replace(/^#/, "");
	const maximized = marked.endsWith(MAXIMIZED);
	const raw = maximized ? marked.slice(0, -MAXIMIZED.length) : marked;
	const at = raw.lastIndexOf("@");
	const named = (at < 0 ? raw : raw.slice(0, at)).split(",").filter(Boolean).map(viewFromPane);
	const focused = named[at < 0 ? 0 : Number(raw.slice(at + 1))] ?? named[0];
	const panes = named.filter((view, index) => named.findIndex(other => sameView(other, view)) === index).slice(0, MAX_PANES);
	return {
		panes,
		focus: Math.max(0, panes.findIndex(view => sameView(view, focused ?? null))),
		maximized: maximized && panes.length > 1,
	};
}

export type OpenMode = "replace" | "split";

/**
 * `view` in the focused pane, or in a new pane for `split`. A view already open gets focus instead of a second pane;
 * a split with {@link MAX_PANES} open replaces the focused pane. A plain open keeps a maximized pane maximized,
 * now showing the opened view; a split brings the split back.
 */
export function openView(layout: Layout, view: View, mode: OpenMode): Layout {
	const { panes, focus } = layout;
	const maximized = layout.maximized && mode === "replace";
	const open = panes.findIndex(pane => sameView(pane, view));
	if (open >= 0) return { panes, focus: open, maximized };
	if (panes.length === 0) return { panes: [view], focus: 0, maximized: false };
	if (mode === "split" && panes.length < MAX_PANES) return { panes: [...panes, view], focus: panes.length, maximized: false };
	return { panes: panes.with(focus, view), focus, maximized };
}

/**
 * The layout without pane `index`. Focus stays on its view, or moves to the pane taking the closed one's place.
 * Closing the maximized pane, or leaving one pane, brings the split back.
 */
export function closePane({ panes, focus, maximized }: Layout, index: number): Layout {
	const rest = panes.filter((_, i) => i !== index);
	return {
		panes: rest,
		focus: index < focus ? focus - 1 : Math.max(0, Math.min(focus, rest.length - 1)),
		maximized: maximized && index !== focus && rest.length > 1,
	};
}

/** The pane showing `from` shows `to` instead and takes focus; without such a pane, `to` opens in the focused pane. */
export function swapView(layout: Layout, from: View, to: View): Layout {
	const index = layout.panes.findIndex(pane => sameView(pane, from));
	if (index < 0) return openView(layout, to, "replace");
	return { ...layout, panes: layout.panes.with(index, to), focus: index };
}

/**
 * The layout once live session `instanceId` ends. Each pane showing it, or one of its subagents, shows the next
 * session in `listed` (the sidebar's running sessions, in order), else the previous, skipping sessions already open.
 * A pane left without one keeps the ended session.
 */
export function endSession(layout: Layout, instanceId: string, listed: string[]): Layout {
	const at = listed.indexOf(instanceId);
	if (at < 0) return layout;
	const neighbors = [...listed.slice(at + 1), ...listed.slice(0, at).reverse()]
		.map((id): View => ({ kind: "live", instanceId: id, agentId: null }))
		.filter(view => !layout.panes.some(pane => sameView(pane, view)));
	const panes = layout.panes.map(pane => (pane.kind === "live" && pane.instanceId === instanceId ? (neighbors.shift() ?? pane) : pane));
	return { ...layout, panes };
}

/**
 * Where a new session starts unless the user picks another directory: the open session's,
 * else the newest live one's, else the newest past one's, each only from `project` when one is selected.
 */
export function defaultCwd(view: View | null, hosts: RosterHost[], past: PastSession[], project: string | null): string {
	const open =
		view?.kind === "live"
			? hosts.find(host => host.instanceId === view.instanceId)
			: past.find(session => session.sessionId === view?.sessionId);
	const rows = [open, ...hosts.toSorted((a, b) => b.startedAt - a.startedAt), ...past];
	// Sessions from old omp versions recorded no directory.
	const chosen = rows.find(row => row?.cwdDisplay && (project === null || row.cwd === project));
	return chosen?.cwdDisplay ?? "~";
}

/** Directories sessions ran in, live ones first, then past ones newest first. The settings page reads a workspace from one. */
export function workspaces(hosts: RosterHost[], past: PastSession[]): { cwd: string; cwdDisplay: string }[] {
	const byCwd = new Map<string, string>();
	for (const row of [...hosts.toSorted((a, b) => b.startedAt - a.startedAt), ...past]) {
		// Sessions from old omp versions recorded no directory.
		if (row.cwd && !byCwd.has(row.cwd)) byCwd.set(row.cwd, row.cwdDisplay);
	}
	return [...byCwd].map(([cwd, cwdDisplay]) => ({ cwd, cwdDisplay }));
}

/** Settings page file groups, in the order the page lists them. */
export const FILE_KIND_LABELS: Record<OmpFileKind, string> = {
	context: "Context",
	"system-prompt": "System prompt",
	"append-system": "Appended system prompt",
	settings: "Settings",
	agent: "Agents",
	command: "Commands",
	rule: "Rules",
	skill: "Skills",
	hook: "Hooks",
};

/** Files by kind in {@link FILE_KIND_LABELS} order, user files before project files; kinds without files left out. */
export function fileGroups(files: OmpFile[]): [OmpFileKind, OmpFile[]][] {
	return (Object.keys(FILE_KIND_LABELS) as OmpFileKind[]).flatMap((kind): [OmpFileKind, OmpFile[]][] => {
		const group = files.filter(file => file.kind === kind).toSorted((a, b) => (a.scope === b.scope ? 0 : a.scope === "user" ? -1 : 1));
		return group.length ? [[kind, group]] : [];
	});
}

export const pullRequestUrl = (pr: PullRequest): string => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;

export const graphiteUrl = (pr: PullRequest): string => `https://app.graphite.com/github/pr/${pr.owner}/${pr.repo}/${pr.number}`;

export const samePullRequest = (a: PullRequest, b: PullRequest): boolean =>
	a.number === b.number && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();

/** Graphite's inbox sections, in page order. A pull request goes in the first section that takes it. */
const INBOX_SECTIONS: [title: string, takes: (pr: InboxPullRequest) => boolean][] = [
	["Needs your review", pr => pr.role === "reviewer" && pr.state !== "merged"],
	["Returned to you", pr => pr.state === "open" && pr.review === "changes-requested"],
	["Approved", pr => pr.state === "open" && pr.review === "approved"],
	["Waiting for review", pr => pr.state === "open"],
	["Drafts", pr => pr.state === "draft"],
	["Recently merged", pr => pr.state === "merged"],
];

export interface InboxSection {
	title: string;
	/** Most recently updated first. */
	pullRequests: InboxPullRequest[];
}

/** A repository's pull requests in Graphite's inbox sections, leaving out the empty ones. */
export function inboxSections(pullRequests: InboxPullRequest[]): InboxSection[] {
	const sections = INBOX_SECTIONS.map(([title]): InboxSection => ({ title, pullRequests: [] }));
	for (const pr of pullRequests.toSorted((a, b) => b.updatedAt - a.updatedAt)) {
		sections[INBOX_SECTIONS.findIndex(([, takes]) => takes(pr))]?.pullRequests.push(pr);
	}
	return sections.filter(section => section.pullRequests.length > 0);
}

/** A repository's key in the inbox's folds and section links: `owner/repo`, lowercased. */
export const inboxRepoKey = ({ owner, repo }: { owner: string; repo: string }): string => `${owner}/${repo}`.toLowerCase();

/** A section of the inbox page, by {@link inboxRepoKey} and title, which a sidebar link scrolls to. */
export interface InboxTarget {
	repo: string;
	title: string;
}

/** The id of a section on the inbox page. It holds no spaces, since `aria-controls` lists ids separated by spaces. */
export const inboxSectionId = ({ repo, title }: InboxTarget): string => `inbox-${repo}-${title.toLowerCase().replaceAll(" ", "-")}`;

/** A pull request link from GitHub or Graphite: `owner`, `repo`, `number`. */
const PR_LINK = /(?:github\.com\/([\w.-]+)\/([\w.-]+)\/pull|app\.graphite\.com\/github\/pr\/([\w.-]+)\/([\w.-]+))\/(\d+)/;

/**
 * Whether a past session matches the sidebar filter. A pasted PR link matches the sessions that
 * submitted or worked on that PR; `#6596` or `6596` also matches any PR with that number; any other text
 * matches the title or directory.
 */
export function matchesFilter(session: PastSession, label: string, query: string): boolean {
	const text = query.trim().toLowerCase();
	if (!text) return true;
	const link = PR_LINK.exec(text);
	if (link) {
		const [owner, repo] = link[1] ? [link[1], link[2]] : [link[3], link[4]];
		return session.pullRequests.some(
			pr => pr.number === Number(link[5]) && pr.owner.toLowerCase() === owner && pr.repo.toLowerCase() === repo,
		);
	}
	const number = /^#?(\d+)$/.exec(text)?.[1];
	if (number && session.pullRequests.some(pr => pr.number === Number(number))) return true;
	return label.toLowerCase().includes(text) || session.cwdDisplay.toLowerCase().includes(text);
}

/** Words that keep their own casing in a label. */
const BRAND_WORDS: Record<string, string> = {
	deepseek: "DeepSeek",
	glm: "GLM",
	gpt: "GPT",
	minimax: "MiniMax",
	moonshotai: "Moonshot AI",
	openai: "OpenAI",
	openrouter: "OpenRouter",
	oss: "OSS",
	xai: "xAI",
};

function labelWord(word: string): string {
	const brand = BRAND_WORDS[word.toLowerCase()];
	if (brand) return brand;
	// Sizes such as a `1m` context, `31b` parameters, or `a3b` active ones.
	if (/^a?\d+(\.\d+)?[bkm]$/i.test(word)) return word.toUpperCase();
	// Versions such as `4o`, and OpenAI's lowercase `o3`.
	if (/^(\d|o\d)/.test(word)) return word;
	return word[0].toUpperCase() + word.slice(1);
}

const labelWords = (words: string[]): string => words.filter(Boolean).map(labelWord).join(" ");

/** A provider id as its name: `openai-codex` reads `OpenAI Codex`. */
export const providerLabel = (provider: string): string => labelWords(provider.split("-"));

/** A skill name as its title: `poteto-mode` reads `Poteto Mode`. */
export const skillLabel = (name: string): string => labelWords(name.split(/[-_\s]+/));

/**
 * A model selector as people name the model, leaving its provider and org to the logo: `anthropic/claude-opus-5-5`
 * reads `Opus 5.5`. A `:suffix`, such as a thinking level or a router's `batch` tier, follows in parentheses.
 */
export function modelLabel(selector: string): string {
	const id = selector.slice(selector.lastIndexOf("/") + 1);
	const colon = id.indexOf(":");
	const name = (colon < 0 ? id : id.slice(0, colon))
		// Anthropic's older ids put the version first: `claude-3-5-sonnet` is Sonnet 3.5.
		.replace(/^claude-(?:([\d.-]*\d)-([a-z]+))?/, (_, version?: string, family?: string) => (version ? `${family}-${version}` : ""))
		.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "");
	const words: string[] = [];
	for (const word of name.split("-")) {
		const last = words.at(-1);
		// `5-5` is version 5.5 and `4-0` plain 4; longer numbers such as `gpt-4-1106` are builds, not minor versions.
		if (last !== undefined && /^\d{1,2}$/.test(last) && /^\d{1,2}$/.test(word)) {
			if (word !== "0") words[words.length - 1] = `${last}.${word}`;
		} else words.push(word);
	}
	const label = labelWords(words).replace(/^GPT (?=\d)/, "GPT-");
	return colon < 0 ? label : `${label} (${id.slice(colon + 1)})`;
}

/**
 * A selector as the model `omp models` lists and its `:level` thinking suffix. Model ids can hold colons
 * (`minimax-m3:batch`), so the suffix splits off only when the rest is a listed model and the whole is not.
 */
export function splitSelector(selector: string, models: ReadonlyMap<string, CatalogModel>): { model: string; level: string | null } {
	const colon = selector.lastIndexOf(":");
	if (colon < 0 || models.has(selector) || !models.has(selector.slice(0, colon))) return { model: selector, level: null };
	return { model: selector.slice(0, colon), level: selector.slice(colon + 1) };
}

/** Providers whose id is not the org that makes their models. */
const PROVIDER_ORGS: Record<string, string> = { "openai-codex": "openai" };

export const providerOrg = (provider: string): string => PROVIDER_ORGS[provider] ?? provider;

/** Model families that resellers such as Cursor serve under their own provider id. */
const FAMILY_ORGS: [RegExp, string][] = [
	[/^claude/, "anthropic"],
	[/^(gpt|o\d|codex)/, "openai"],
	[/^deepseek/, "deepseek"],
	[/^kimi/, "moonshotai"],
];

/** The org that makes a `provider/id` model: a router's `org/model` id names it, else the model family, else the provider. */
export function modelOrg(selector: string): string {
	const slash = selector.indexOf("/");
	const provider = selector.slice(0, slash);
	const id = selector.slice(slash + 1);
	const routed = id.indexOf("/");
	if (routed >= 0) return id.slice(0, routed).replace(/^~/, "");
	return FAMILY_ORGS.find(([family]) => family.test(id))?.[1] ?? providerOrg(provider);
}

/** Apply an `items` message: replace on reset, else upsert by id and append new ids. */
export function applyItems(prev: Item[], reset: boolean, items: Item[]): Item[] {
	if (reset) return items;
	const next = [...prev];
	const index = new Map(next.map((item, i) => [item.id, i]));
	for (const item of items) {
		const at = index.get(item.id);
		if (at === undefined) {
			index.set(item.id, next.length);
			next.push(item);
		} else {
			next[at] = item;
		}
	}
	return next;
}

export function toBlocks(items: Item[]): Block[] {
	const blocks: Block[] = [];
	for (const item of items) {
		const last = blocks.at(-1);
		if (item.kind !== "tool") blocks.push({ kind: "item", item });
		else if (last?.kind === "tools") last.tools.push(item);
		else blocks.push({ kind: "tools", id: item.id, tools: [item] });
	}
	return blocks;
}

/** Where a message forks. omp branches only at a user prompt, keeping the history before it. */
export interface ForkPoint {
	entryId: string;
	/** Forking a prompt starts the composer with it to edit; forking a reply starts it empty. */
	prefill: boolean;
}

/**
 * Fork points by item id. A prompt forks at itself. A turn's last reply forks at the next prompt,
 * keeping the whole turn; earlier replies in the turn, a reply still streaming, and a reply no
 * forkable prompt follows have none.
 */
export function forkPoints(items: Item[]): Map<string, ForkPoint> {
	const points = new Map<string, ForkPoint>();
	let nextPrompt: string | null = null;
	let replyFound = false;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item.kind === "user") {
			nextPrompt = item.entryId;
			replyFound = false;
			if (item.entryId) points.set(item.id, { entryId: item.entryId, prefill: true });
		} else if (item.kind === "assistant" && !replyFound) {
			replyFound = true;
			if (nextPrompt && !item.streaming) points.set(item.id, { entryId: nextPrompt, prefill: false });
		}
	}
	return points;
}

/** Depth-first parent/child order. Rows whose parent is not listed start a top-level branch. */
export function agentTree(agents: AgentRow[]): AgentNode[] {
	const ids = new Set(agents.map(agent => agent.id));
	const children = new Map<string | null, AgentRow[]>();
	for (const agent of agents) {
		const parent = agent.parentId !== null && ids.has(agent.parentId) ? agent.parentId : null;
		children.set(parent, [...(children.get(parent) ?? []), agent]);
	}
	const out: AgentNode[] = [];
	const visit = (parent: string | null, depth: number): void => {
		for (const agent of children.get(parent) ?? []) {
			out.push({ agent, depth });
			visit(agent.id, depth + 1);
		}
	};
	visit(null, 0);
	return out;
}
