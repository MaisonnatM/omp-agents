/**
 * The bell's notices: what the last checks found, how each update the user started went, and which notices the user saw,
 * read, or cleared, which `notices.json` keeps across restarts. Each kind has its own check.
 */
import { JsonFile } from "../fs";
import type { SignedOutAccount } from "../google-accounts";
import { errorText, isObject } from "../json";
import { type PullRequestList, prKey, repoKey } from "../shared/github";
import { type AgentOn, yourMoves } from "../shared/moves";
import type { DashboardNews, DashboardUpdateOutcome } from "../shared/dashboard-update";
import type { PlanUsage } from "../shared/models";
import type { CreditsSubject, EventSubject, ModelUpdate, Notice, NoticeKind, NoticeOp, NoticeStatus, NoticeSubject, StoppedSession, UpdateSubject } from "../shared/notices";
import { EVENT_LEAD_MS, usesClause } from "../shared/notices";
import type { SlackFound } from "../slack-messages";

/** A timed calendar event; `ref` names it among the events: `local/<id>`, or `google/<account>/<calendar id>/<event id>`. */
export type FoundEvent = Omit<EventSubject, "kind"> & { ref: string };

/** One Google Calendar account's timed events, `null` when the account did not answer. */
export interface AccountFoundEvents {
	account: string;
	events: FoundEvent[] | null;
}

export interface NoticeSources {
	/** The newest omp release, or `null` when omp's settings turn the check off. */
	latestOmp(): Promise<string | null>;
	/** The version of the omp installed on disk. */
	installedOmp(): string;
	/** Runs `omp update`; answers with the version it installed, at least `latest`. */
	updateOmp(latest: string): Promise<string>;
	modelUpdates(): Promise<ModelUpdate[]>;
	upgradeModel(update: ModelUpdate): Promise<void>;
	/**
	 * How many commits origin's branch holds past the commit the omp-agents server runs, after fetching it, or the update that
	 * did not start while origin still holds its commit; `null` for no commits, or when it cannot update itself.
	 */
	dashboardNews(): Promise<DashboardNews | null>;
	/** Pulls omp-agents' checkout and restarts the server; rejects with why it cannot. */
	updateDashboard(): Promise<DashboardUpdateOutcome>;
	/** Every workspace's pull request list, and where the running sessions on each pull request stand. */
	pullRequests(): Promise<{ list: PullRequestList; agent: AgentOn }>;
	/** The Slack messages that wait on you; none while Slack is not connected. */
	slack(): Promise<SlackFound[]>;
	/** The plans the last `omp usage` reported; rejects when it failed. */
	plans(): Promise<PlanUsage[]>;
	/** Each provider whose prepaid credits ran out, as its latest requests failed. */
	creditRuns(): Promise<Omit<CreditsSubject, "kind">[]>;
	/** The timed events kept on this computer. */
	localEvents(): FoundEvent[];
	/** The timed events of each signed-in Google Calendar account's shown calendars that overlap `from` to `to`, epoch ms. */
	googleEvents(from: number, to: number): Promise<AccountFoundEvents[]>;
	/** The interrupted dashboard sessions that stopped while their turn ran. */
	stoppedSessions(): StoppedSession[];
	/** The Google accounts sessions reported signed out that still do not work. */
	signedOut(): Promise<SignedOutAccount[]>;
	now(): number;
}

/** The kinds the update check looks for. */
export const UPDATE_KINDS = ["omp", "model"] as const satisfies readonly NoticeKind[];
/** The kinds the dashboard check looks for, which fetches omp-agents' own branch. */
export const DASHBOARD_KINDS = ["dashboard"] as const satisfies readonly NoticeKind[];
/** The kinds the activity check looks for. */
export const ACTIVITY_KINDS = ["pull-request", "slack"] as const satisfies readonly NoticeKind[];
/** The kinds the provider check looks for. */
export const PROVIDER_KINDS = ["plan", "credits"] as const satisfies readonly NoticeKind[];
/** The kinds the event check looks for. */
export const EVENT_KINDS = ["event"] as const satisfies readonly NoticeKind[];
/** The kinds the stopped-sessions check looks for. */
export const STOPPED_KINDS = ["stopped"] as const satisfies readonly NoticeKind[];
/** The kinds the sign-in check looks for, which lists each reported account's tools. */
export const SIGN_IN_KINDS = ["sign-in"] as const satisfies readonly NoticeKind[];

const MARKS = ["seen", "read", "cleared"] as const;
type Mark = (typeof MARKS)[number];
/** The ids of each mark, and the scope of each marked notice, so a restart can tell which check would find it again. */
type Marks = Record<Mark, string[]> & { scopes: Record<string, string> };
/**
 * A notice the user marked: its marks, never empty; its scope, `null` from a file older than marks' scopes until a check
 * finds it again; and since when the checks no longer find it.
 */
interface Marked {
	marks: Set<Mark>;
	scope: string | null;
	goneSince: number | null;
}

/** How long a mark outlives its notice: a pull request whose state flickers, as GitHub works out its conflicts again, does not toast twice. */
const MARK_GRACE_MS = 10 * 60_000;

/**
 * A notice a check found. Its `scope` is what one answer covers: its kind, a pull request's repository, or Google's or the
 * local calendar events.
 */
type Found = Unscoped & { scope: string };
type Unscoped = { id: string; at: number } & NoticeSubject;

/**
 * What one kind's check found, and the scopes it looked at; a notice of a scope it could not look at, such as a repository
 * GitHub did not answer for, keeps its last state.
 */
interface Checked {
	found: Found[];
	scopes: ReadonlySet<string>;
	/** Each found notice's time is when its news came, as a message's, rather than the latest it could be, as a pull request's last update. */
	dated: boolean;
}

const AVAILABLE: NoticeStatus = { state: "available" };

/** What a failed check's log line says it looked for. */
const LOOKED_FOR: Record<NoticeKind, string> = {
	omp: "a newer omp",
	model: "newer models",
	dashboard: "omp-agents updates",
	"dashboard-failed": "omp-agents updates",
	"pull-request": "your pull requests' moves",
	slack: "Slack messages",
	plan: "used-up plans",
	credits: "providers out of credits",
	event: "calendar events",
	stopped: "sessions that stopped mid-turn",
	"sign-in": "signed-out Google accounts",
};

/**
 * The check that follows each kind's successful update. A dashboard update restarts the server, whose startup check
 * counts again: a fetch now would still hold `.git`'s lock when the restarted server's check fetches.
 */
const RECHECK_AFTER: Record<UpdateSubject["kind"], readonly NoticeKind[] | null> = { omp: UPDATE_KINDS, model: UPDATE_KINDS, dashboard: null };

const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string");

const isScopes = (value: unknown): value is Record<string, string> => isObject(value) && Object.values(value).every(scope => typeof scope === "string");

/** Whether `found` offers an update the user starts, and so carries its status. */
const isUpdate = <T extends { kind: NoticeKind }>(found: T): found is T & UpdateSubject => found.kind === "omp" || found.kind === "model" || found.kind === "dashboard";

/**
 * The marks `notices.json` holds; a file from before notices could be read holds no `read`, and one from before marks kept
 * their scopes holds no `scopes`, whose marks stay until their notices are found again.
 */
function parseMarks(value: unknown): Marks | null {
	if (!isObject(value) || !isIds(value.seen) || !isIds(value.cleared)) return null;
	return { seen: value.seen, read: isIds(value.read) ? value.read : [], cleared: value.cleared, scopes: isScopes(value.scopes) ? value.scopes : {} };
}

/** The pull requests of `list` whose next move is yours, each a notice per move; the repositories GitHub did not answer for stay unchecked. */
function pullRequestNotices(list: PullRequestList, agent: AgentOn): Checked {
	const { answered, yours } = yourMoves(list, agent);
	const found = yours.map(({ repo, pr, move }) => ({ id: `pull-request:${prKey(pr)}:${move}`, at: pr.updatedAt, scope: repoKey(repo), kind: "pull-request", pr, move, cwd: repo.cwds[0] ?? "" }) as const);
	return { found, scopes: new Set(answered.map(repoKey)), dated: false };
}

/**
 * A notice for each used-up window of `plans`. Its id leaves out the reset time, which some providers report a little
 * differently on each poll.
 */
function planNotices(plans: PlanUsage[], at: number): Unscoped[] {
	return plans.flatMap(({ provider, name, account, windows, resetCredits }) =>
		windows
			.filter(window => window.exhausted)
			.map(window => ({
				id: `plan:${provider}/${account ?? ""}:${window.id}`,
				at,
				kind: "plan" as const,
				provider,
				name,
				account,
				windowTitle: window.title,
				resetsAt: window.resetsAt,
				resetCredits: resetCredits?.count ?? 0,
			})),
	);
}

/**
 * A notice for each event of `local` and `google` that starts within {@link EVENT_LEAD_MS} of `now` or runs then, dated
 * that lead before its start. Each Google Calendar account is a scope of its own: an account that did not answer, or
 * all of them when `google` is `null`, keeps its events' notices as they were, as the Calendar page shows why. The scope
 * every Google event had before accounts counts as answered, so notices kept from then clear.
 */
function eventNotices(local: FoundEvent[], google: AccountFoundEvents[] | null, now: number): Checked {
	const scoped = (events: FoundEvent[], scope: string): Found[] =>
		events
			.filter(({ start, end }) => start - EVENT_LEAD_MS <= now && now < end)
			.map(({ ref, ...event }) => ({ id: `event:${ref}:${event.start}`, at: event.start - EVENT_LEAD_MS, scope, kind: "event" as const, ...event }));
	const answered = (google ?? []).flatMap(({ account, events }) => (events === null ? [] : [{ scope: `event:google/${account}`, events }]));
	return {
		found: [...scoped(local, "event:local"), ...answered.flatMap(({ scope, events }) => scoped(events, scope))],
		scopes: new Set(["event:local", ...(google === null ? [] : ["event:google"]), ...answered.map(({ scope }) => scope)]),
		dated: true,
	};
}

/**
 * One notice for every session in `sessions`, none when it is empty. Its id names the set, so a session that stops
 * later makes it news again.
 */
function stoppedNotices(sessions: StoppedSession[], at: number): Unscoped[] {
	if (sessions.length === 0) return [];
	const sorted = sessions.toSorted((a, b) => a.sessionId.localeCompare(b.sessionId));
	return [{ id: `stopped:${sorted.map(({ sessionId }) => sessionId).join(",")}`, at, kind: "stopped", sessions: sorted }];
}

export class Notices {
	readonly #file: JsonFile<Marks>;
	readonly #sources: NoticeSources;
	readonly #changed: () => void;
	/** Each marked notice, by id; one entry, so forgetting a notice forgets its marks, scope, and absence together. */
	readonly #marked = new Map<string, Marked>();
	/** By id, in the order found. */
	#found = new Map<string, Found>();
	/** The status of each notice the user updated; any other is available. */
	readonly #status = new Map<string, NoticeStatus>();
	/** The scopes checked since the server started. */
	readonly #answered = new Set<string>();
	/** Each kind's last failure, logged once until it changes. */
	readonly #failures = new Map<NoticeKind, string>();

	constructor(path: string, sources: NoticeSources, changed: () => void) {
		this.#file = new JsonFile(path, { parse: parseMarks, holds: "notice marks", onInvalid: "ignore" });
		const marks = this.#file.load();
		for (const mark of MARKS) for (const id of marks?.[mark] ?? []) this.#mark(id, mark, marks?.scopes[id] ?? null);
		this.#sources = sources;
		this.#changed = changed;
	}

	/** What the bell lists: every notice found but not cleared, newest first. */
	get list(): Notice[] {
		return [...this.#found.values()]
			.filter(({ id }) => !this.#marked.get(id)?.marks.has("cleared"))
			.map(({ scope: _, ...found }): Notice => {
				const marked = this.#marked.get(found.id)?.marks;
				const marks = { seen: marked?.has("seen") ?? false, read: marked?.has("read") ?? false };
				return isUpdate(found) ? { ...found, ...marks, status: this.#status.get(found.id) ?? AVAILABLE } : { ...found, ...marks };
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
		const answered = new Set<string>();
		kinds.forEach((kind, at) => {
			const result = results[at];
			if (result.status === "rejected") {
				const failure = errorText(result.reason);
				if (this.#failures.get(kind) !== failure) console.error(`omp-agents: could not check for ${LOOKED_FOR[kind]}: ${failure}`);
				this.#failures.set(kind, failure);
				return;
			}
			this.#failures.delete(kind);
			const { found, scopes, dated } = result.value;
			for (const [id, { scope }] of next) if (scopes.has(scope) && !this.#updateStarted(id)) next.delete(id);
			for (const item of found) next.set(item.id, { ...item, at: before.get(item.id)?.at ?? (!dated && this.#answered.has(item.scope) ? now : item.at) });
			for (const scope of scopes) answered.add(scope);
		});
		for (const scope of answered) this.#answered.add(scope);
		this.#found = next;
		const carried = this.#carryStoppedMarks(before, next);
		for (const id of this.#status.keys()) if (!next.has(id)) this.#status.delete(id);
		let rescoped = false;
		for (const [id, { scope }] of next) {
			const marked = this.#marked.get(id);
			if (marked && marked.scope !== scope) {
				marked.scope = scope;
				rescoped = true;
			}
		}
		const missingFromAnAnswer = (id: string, { scope }: Marked): boolean => !next.has(id) && scope !== null && answered.has(scope);
		if (this.#forgetGone(now, missingFromAnAnswer) || rescoped || carried) this.#save();
		this.#changed();
	}

	/**
	 * Gives the stopped notice a check found the marks of the one it replaced when it lists only sessions the old one
	 * did, so a session that runs again is no news, while one that stops is. Whether any mark carried.
	 */
	#carryStoppedMarks(before: ReadonlyMap<string, Found>, next: ReadonlyMap<string, Found>): boolean {
		const replaced = before.values().find(found => found.kind === "stopped" && !next.has(found.id));
		const replacement = next.values().find(found => found.kind === "stopped" && !before.has(found.id));
		if (replaced?.kind !== "stopped" || replacement?.kind !== "stopped") return false;
		const listed = new Set(replaced.sessions.map(({ sessionId }) => sessionId));
		if (!replacement.sessions.every(({ sessionId }) => listed.has(sessionId))) return false;
		const marked = this.#marked.get(replaced.id);
		if (!marked) return false;
		for (const mark of marked.marks) this.#mark(replacement.id, mark, replacement.scope);
		return true;
	}

	#mark(id: string, mark: Mark, scope: string | null): void {
		const marked = this.#marked.get(id);
		if (!marked) this.#marked.set(id, { marks: new Set([mark]), scope, goneSince: null });
		else {
			marked.marks.add(mark);
			if (scope !== null) marked.scope = scope;
		}
	}

	/** Forgets the marks of each notice `gone` says the checks no longer find, once it has been gone {@link MARK_GRACE_MS}. Whether any went. */
	#forgetGone(now: number, gone: (id: string, marked: Marked) => boolean): boolean {
		let forgot = false;
		for (const [id, marked] of this.#marked) {
			if (!gone(id, marked)) {
				if (this.#found.has(id)) marked.goneSince = null;
				continue;
			}
			marked.goneSince ??= now;
			if (now - marked.goneSince < MARK_GRACE_MS) continue;
			this.#marked.delete(id);
			forgot = true;
		}
		return forgot;
	}

	async #find(kind: NoticeKind): Promise<Checked> {
		const all = (found: Unscoped[], dated: boolean): Checked => ({ found: found.map(item => ({ ...item, scope: kind })), scopes: new Set([kind]), dated });
		switch (kind) {
			case "omp":
				return all(await this.#ompNotices(), false);
			case "model":
				return all(await this.#modelNotices(), false);
			// One check finds both: the commits past the running build, or the update that did not start.
			case "dashboard":
			case "dashboard-failed":
				return all(await this.#dashboardNotices(), false);
			case "pull-request": {
				const { list, agent } = await this.#sources.pullRequests();
				return pullRequestNotices(list, agent);
			}
			case "slack":
				return all(await this.#sources.slack(), true);
			case "plan":
				return all(planNotices(await this.#sources.plans(), this.#sources.now()), false);
			case "credits":
				return all(
					(await this.#sources.creditRuns()).map(run => ({ id: `credits:${run.provider}`, at: run.since, kind: "credits", ...run })),
					true,
				);
			case "event": {
				const now = this.#sources.now();
				const google = await this.#sources.googleEvents(now, now + EVENT_LEAD_MS).catch(() => null);
				return eventNotices(this.#sources.localEvents(), google, now);
			}
			case "stopped":
				return all(stoppedNotices(this.#sources.stoppedSessions(), this.#sources.now()), false);
			case "sign-in":
				return all(
					(await this.#sources.signedOut()).map(({ since, ...account }) => ({ id: `sign-in:${account.account}:${since}`, at: since, kind: "sign-in", ...account })),
					true,
				);
		}
	}

	/** Whether an update of notice `id` runs or ran. */
	#updateStarted(id: string): boolean {
		const state = this.#status.get(id)?.state;
		return state === "updating" || state === "updated";
	}

	/** `update` runs each update and, once one succeeds, checks again as {@link RECHECK_AFTER} says; the others mark notices `ids`. An unlisted id does nothing. */
	async apply(ids: string[], op: NoticeOp): Promise<void> {
		const listed = ids.flatMap(id => this.#found.get(id) ?? []);
		if (listed.length === 0) return;
		if (op === "update") {
			await Promise.all(listed.map(found => (isUpdate(found) ? this.#update(found) : undefined)));
			return;
		}
		for (const { id, scope } of listed) this.#mark(id, op === "clear" ? "cleared" : op, scope);
		this.#save();
		this.#changed();
	}

	async #update(found: Found & UpdateSubject): Promise<void> {
		if (this.#updateStarted(found.id)) return;
		this.#mark(found.id, "seen", found.scope);
		this.#mark(found.id, "read", found.scope);
		this.#save();
		this.#setStatus(found.id, { state: "updating" });
		try {
			this.#setStatus(found.id, { state: "updated", note: await this.#run(found) });
		} catch (err) {
			this.#setStatus(found.id, { state: "failed", error: errorText(err) });
			return;
		}
		const recheck = RECHECK_AFTER[found.kind];
		if (recheck) await this.check(recheck);
	}

	/** Runs the update `subject` offers; answers what it did. */
	async #run(subject: UpdateSubject): Promise<string> {
		switch (subject.kind) {
			case "omp":
				return `omp ${await this.#sources.updateOmp(subject.latest)} is installed. Restart omp-agents to load it.`;
			case "model":
				return this.#upgrade(subject);
			case "dashboard": {
				const outcome = await this.#sources.updateDashboard();
				return outcome.kind === "current" ? "omp-agents already runs the newest commit." : `Restarting omp-agents at ${outcome.to.slice(0, 7)}…`;
			}
			default: {
				const unhandled: never = subject;
				return unhandled;
			}
		}
	}

	async #upgrade(update: ModelUpdate): Promise<string> {
		await this.#sources.upgradeModel(update);
		return `${usesClause(update.uses)} ${update.to.name} now.`;
	}

	async #ompNotices(): Promise<Unscoped[]> {
		const latest = await this.#sources.latestOmp();
		const current = this.#sources.installedOmp();
		return latest !== null && Bun.semver.order(latest, current) > 0 ? [{ id: `omp:${latest}`, at: this.#sources.now(), kind: "omp", current, latest }] : [];
	}

	async #modelNotices(): Promise<Unscoped[]> {
		const at = this.#sources.now();
		return (await this.#sources.modelUpdates()).map(update => ({ id: `model:${update.provider}/${update.from.id}>${update.to.id}`, at, kind: "model", ...update }));
	}

	/**
	 * One notice per running build, so the count of new commits grows on it rather than toasting again for each, and
	 * another for the update that did not start, which toasts once.
	 */
	async #dashboardNotices(): Promise<Unscoped[]> {
		const found = await this.#sources.dashboardNews();
		if (found === null) return [];
		const id = found.kind === "dashboard-failed" ? `dashboard:${found.running}:failed:${found.failed.commit}` : `dashboard:${found.running}`;
		return [{ id, at: this.#sources.now(), ...found }];
	}

	#setStatus(id: string, status: NoticeStatus): void {
		this.#status.set(id, status);
		this.#changed();
	}

	#save(): void {
		const marked = [...this.#marked];
		const ids = (mark: Mark): string[] => marked.flatMap(([id, { marks }]) => (marks.has(mark) ? [id] : []));
		const scopes = Object.fromEntries(marked.flatMap(([id, { scope }]) => (scope === null ? [] : [[id, scope]])));
		this.#file.save({ seen: ids("seen"), read: ids("read"), cleared: ids("cleared"), scopes });
	}
}
