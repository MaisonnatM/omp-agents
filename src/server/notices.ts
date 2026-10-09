/**
 * The bell's notices: what the last checks found, how each update the user started went, and which notices the user saw,
 * read, or cleared, which `notices.json` keeps across restarts. Each kind has its own check.
 */
import { JsonFile } from "../fs";
import { errorText, isObject } from "../json";
import { type Inbox, prKey, repoKey } from "../shared/github";
import { type AgentOn, moveOf, YOUR_MOVES, type YourMove } from "../shared/moves";
import type { ModelUpdate, Notice, NoticeKind, NoticeOp, NoticeStatus, NoticeSubject } from "../shared/notices";
import { usesClause } from "../shared/notices";
import type { SlackFound } from "../slack-messages";

export interface NoticeSources {
	/** The newest omp release, or `null` when omp's settings turn the check off. */
	latestOmp(): Promise<string | null>;
	/** The version of the omp installed on disk. */
	installedOmp(): string;
	/** Runs `omp update`; answers with the version it installed, at least `latest`. */
	updateOmp(latest: string): Promise<string>;
	modelUpdates(): Promise<ModelUpdate[]>;
	upgradeModel(update: ModelUpdate): Promise<void>;
	/** Every project's inbox, and where the running sessions on each pull request stand. */
	inbox(): Promise<{ inbox: Inbox; agent: AgentOn }>;
	/** The Slack messages that wait on you; none while Slack is not connected. */
	slack(): Promise<SlackFound[]>;
	now(): number;
}

/** The kinds the update check looks for. */
export const UPDATE_KINDS = ["omp", "model"] as const satisfies readonly NoticeKind[];
/** The kinds the activity check looks for. */
export const ACTIVITY_KINDS = ["pull-request", "slack"] as const satisfies readonly NoticeKind[];

const MARKS = ["seen", "read", "cleared"] as const;
type Mark = (typeof MARKS)[number];
type Marks = Record<Mark, string[]>;

/** How long a mark outlives its notice: a pull request whose state flickers, as GitHub works out its conflicts again, does not toast twice. */
const MARK_GRACE_MS = 10 * 60_000;

type Found = { id: string; at: number } & NoticeSubject;

/**
 * What one kind's check found, and the ids it could not look at, such as a repository GitHub did not answer for, which
 * keep their last state. Each id belongs to a scope, the kind or a pull request's repository, and `answered` lists the
 * scopes this check looked at.
 */
interface Checked {
	found: Found[];
	unchecked: (id: string) => boolean;
	scopeOf: (id: string) => string;
	answered: string[];
	/** Each found notice's time is when its news came, as a message's, rather than the latest it could be, as a pull request's last update. */
	dated: boolean;
}

const AVAILABLE: NoticeStatus = { state: "available" };

/** What a failed check's log line says it looked for. */
const LOOKED_FOR: Record<NoticeKind, string> = { omp: "a newer omp", model: "newer models", "pull-request": "your pull requests' moves", slack: "Slack messages" };

const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string");

/** The marks `notices.json` holds; a file from before notices could be read holds no `read`. */
function parseMarks(value: unknown): Marks | null {
	if (!isObject(value) || !isIds(value.seen) || !isIds(value.cleared)) return null;
	return { seen: value.seen, read: isIds(value.read) ? value.read : [], cleared: value.cleared };
}

const kindOf = (id: string): string => id.slice(0, id.indexOf(":"));

const isYourMove = (move: string): move is YourMove => (YOUR_MOVES as readonly string[]).includes(move);

/** The pull request notice `id`'s repository, `owner/repo`. */
const repoOf = (id: string): string => id.slice("pull-request:".length, id.lastIndexOf("#"));

/** The pull requests of `inbox` whose next move is yours, each a notice per move; the repositories GitHub did not answer for stay unchecked. */
function pullRequestNotices(inbox: Inbox, agent: AgentOn): Checked {
	const failed = new Set(inbox.repos.flatMap(repo => ("error" in repo ? [repoKey(repo)] : [])));
	const found = inbox.repos.flatMap(repo =>
		"error" in repo
			? []
			: repo.pullRequests.flatMap(pr => {
					const move = moveOf(pr, agent(pr));
					return isYourMove(move) ? [{ id: `pull-request:${prKey(pr)}:${move}`, at: pr.updatedAt, kind: "pull-request", pr, move, cwd: repo.cwds[0] ?? "" } as const] : [];
				}),
	);
	const answered = inbox.repos.flatMap(repo => ("error" in repo ? [] : [repoKey(repo)]));
	return { found, unchecked: id => failed.has(repoOf(id)), scopeOf: repoOf, answered, dated: false };
}

export class Notices {
	readonly #file: JsonFile<Marks>;
	readonly #sources: NoticeSources;
	readonly #changed: () => void;
	readonly #marks: Record<Mark, Set<string>>;
	/** By id, in the order found. */
	#found = new Map<string, Found>();
	/** The status of each notice the user updated; any other is available. */
	readonly #status = new Map<string, NoticeStatus>();
	/** The scopes checked since the server started. */
	readonly #answered = new Set<string>();
	/** When each marked notice stopped being found. */
	readonly #gone = new Map<string, number>();
	/** Each kind's last failure, logged once until it changes. */
	readonly #failures = new Map<NoticeKind, string>();

	constructor(path: string, sources: NoticeSources, changed: () => void) {
		this.#file = new JsonFile(path, { parse: parseMarks, holds: "notice marks", onInvalid: "ignore" });
		const marks = this.#file.load();
		this.#marks = { seen: new Set(marks?.seen), read: new Set(marks?.read), cleared: new Set(marks?.cleared) };
		this.#sources = sources;
		this.#changed = changed;
	}

	/** What the bell lists: every notice found but not cleared, newest first. */
	get list(): Notice[] {
		return [...this.#found.values()]
			.filter(({ id }) => !this.#marks.cleared.has(id))
			.map((found): Notice => {
				const marks = { seen: this.#marks.seen.has(found.id), read: this.#marks.read.has(found.id) };
				return found.kind === "omp" || found.kind === "model" ? { ...found, ...marks, status: this.#status.get(found.id) ?? AVAILABLE } : { ...found, ...marks };
			})
			.toSorted((a, b) => b.at - a.at);
	}

	/**
	 * Checks `kinds` again. A check that fails keeps what the last one found; a notice whose update ran or runs stays until
	 * the user clears it, so its outcome shows even once the check no longer finds it.
	 */
	async check(kinds: readonly NoticeKind[]): Promise<void> {
		const now = this.#sources.now();
		const results = await Promise.allSettled(kinds.map(kind => this.#find(kind)));
		const before = this.#found;
		const next = new Map(before);
		const covered: ((id: string) => boolean)[] = [];
		kinds.forEach((kind, at) => {
			const result = results[at];
			if (result.status === "rejected") {
				const failure = errorText(result.reason);
				if (this.#failures.get(kind) !== failure) console.error(`omp-agents: could not check for ${LOOKED_FOR[kind]}: ${failure}`);
				this.#failures.set(kind, failure);
				return;
			}
			this.#failures.delete(kind);
			const { found, unchecked, scopeOf, answered, dated } = result.value;
			const answers = (id: string): boolean => kindOf(id) === kind && !unchecked(id);
			covered.push(answers);
			for (const id of next.keys()) if (answers(id) && !this.#updateStarted(id)) next.delete(id);
			const isNews = (id: string): boolean => !dated && this.#answered.has(scopeOf(id));
			for (const item of found) next.set(item.id, { ...item, at: before.get(item.id)?.at ?? (isNews(item.id) ? now : item.at) });
			for (const scope of answered) this.#answered.add(scope);
		});
		this.#found = next;
		for (const id of this.#status.keys()) if (!next.has(id)) this.#status.delete(id);
		const missingFromAnAnswer = (id: string): boolean => !next.has(id) && covered.some(answers => answers(id));
		if (this.#forgetGone(now, missingFromAnAnswer)) this.#save();
		this.#changed();
	}

	/** Forgets the marks of each notice `gone` says the checks no longer find, once it has been gone {@link MARK_GRACE_MS}. Whether any went. */
	#forgetGone(now: number, gone: (id: string) => boolean): boolean {
		let forgot = false;
		for (const marks of Object.values(this.#marks)) {
			for (const id of marks) {
				if (!gone(id)) {
					if (this.#found.has(id)) this.#gone.delete(id);
					continue;
				}
				const since = this.#gone.get(id) ?? now;
				this.#gone.set(id, since);
				if (now - since >= MARK_GRACE_MS) forgot = marks.delete(id) || forgot;
			}
		}
		for (const id of this.#gone.keys()) if (!MARKS.some(mark => this.#marks[mark].has(id))) this.#gone.delete(id);
		return forgot;
	}

	async #find(kind: NoticeKind): Promise<Checked> {
		const all = (found: Found[], dated: boolean): Checked => ({ found, unchecked: () => false, scopeOf: () => kind, answered: [kind], dated });
		switch (kind) {
			case "omp":
				return all(await this.#ompNotices(), false);
			case "model":
				return all(await this.#modelNotices(), false);
			case "pull-request": {
				const { inbox, agent } = await this.#sources.inbox();
				return pullRequestNotices(inbox, agent);
			}
			case "slack":
				return all(await this.#sources.slack(), true);
		}
	}

	/** Whether an update of notice `id` runs or ran. */
	#updateStarted(id: string): boolean {
		const state = this.#status.get(id)?.state;
		return state === "updating" || state === "updated";
	}

	/** `update` runs each update and, once one succeeds, checks again; the others mark notices `ids`. An unlisted id does nothing. */
	async apply(ids: string[], op: NoticeOp): Promise<void> {
		const listed = ids.flatMap(id => this.#found.get(id) ?? []);
		if (listed.length === 0) return;
		if (op === "update") {
			await Promise.all(listed.map(found => (found.kind === "omp" || found.kind === "model" ? this.#update(found) : undefined)));
			return;
		}
		for (const { id } of listed) this.#marks[op === "clear" ? "cleared" : op].add(id);
		this.#save();
		this.#changed();
	}

	async #update(found: Found & { kind: "omp" | "model" }): Promise<void> {
		if (this.#updateStarted(found.id)) return;
		this.#marks.seen.add(found.id);
		this.#marks.read.add(found.id);
		this.#save();
		this.#setStatus(found.id, { state: "updating" });
		try {
			const note = found.kind === "omp" ? `omp ${await this.#sources.updateOmp(found.latest)} is installed. Restart omp-agents to load it.` : await this.#upgrade(found);
			this.#setStatus(found.id, { state: "updated", note });
		} catch (err) {
			this.#setStatus(found.id, { state: "failed", error: errorText(err) });
			return;
		}
		await this.check(UPDATE_KINDS);
	}

	async #upgrade(update: ModelUpdate): Promise<string> {
		await this.#sources.upgradeModel(update);
		return `${usesClause(update.uses)} ${update.to.name} now.`;
	}

	async #ompNotices(): Promise<Found[]> {
		const latest = await this.#sources.latestOmp();
		const current = this.#sources.installedOmp();
		return latest !== null && Bun.semver.order(latest, current) > 0 ? [{ id: `omp:${latest}`, at: this.#sources.now(), kind: "omp", current, latest }] : [];
	}

	async #modelNotices(): Promise<Found[]> {
		const at = this.#sources.now();
		return (await this.#sources.modelUpdates()).map(update => ({ id: `model:${update.provider}/${update.from.id}>${update.to.id}`, at, kind: "model", ...update }));
	}

	#setStatus(id: string, status: NoticeStatus): void {
		this.#status.set(id, status);
		this.#changed();
	}

	#save(): void {
		this.#file.save({ seen: [...this.#marks.seen], read: [...this.#marks.read], cleared: [...this.#marks.cleared] });
	}
}
