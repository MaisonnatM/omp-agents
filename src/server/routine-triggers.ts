/**
 * What routines' triggers see: the pull requests, Slack messages, and calendar events the bell's checks read, turned into
 * sightings, and the watch that tells which sightings are new since the last answer for their scope.
 */
import { MAX_TRIGGER_DETAIL, type TriggerEvent } from "../routines";
import { prKey, pullRequestName, pullRequestUrl, type PullRequestList, repoKey } from "../shared/github";
import { type MoveId, moveOf } from "../shared/moves";
import { EVENT_LEAD_MS } from "../shared/notices";
import type { SlackFound } from "../slack-messages";
import type { FoundEvent } from "./notices";

/**
 * One thing a check found that a trigger may start a run for. `id` names it in the state that made it, so a change, such
 * as a pull request's new status, is a new id; `scope` is what one answer of its check covers.
 */
export interface Sighting {
	id: string;
	scope: string;
	event: TriggerEvent;
}

/** What one check answered: the scopes it looked at, and what it saw in them. */
export interface Seen {
	scopes: string[];
	sightings: Sighting[];
}

/**
 * Compares each answered scope's sightings with that scope's last answer: the ones it had not seen are news, kept until
 * taken, so the sources of one check start one run of a routine. A scope's first answer since the server started, or
 * since {@link forget}, is no news, so a restart does not fire for what was already there.
 */
export class TriggerWatch {
	/** The ids of each scope's last answer. */
	readonly #known = new Map<string, Set<string>>();
	#news: TriggerEvent[] = [];

	/** Learns what `seen` answered; a scope it did not answer keeps what it knew. */
	learn({ scopes, sightings }: Seen): void {
		for (const scope of scopes) {
			const found = sightings.filter(sighting => sighting.scope === scope);
			const known = this.#known.get(scope);
			if (known) this.#news.push(...found.filter(({ id }) => !known.has(id)).map(({ event }) => event));
			this.#known.set(scope, new Set(found.map(({ id }) => id)));
		}
	}

	/** The news learned since the last take, in the order learned. */
	take(): TriggerEvent[] {
		const news = this.#news;
		this.#news = [];
		return news;
	}

	/** Forgets every scope's last answer and the news not taken, so what a server learned before it ran routines fires nothing. */
	forget(): void {
		this.#known.clear();
		this.#news = [];
	}
}

const clip = (text: string): string => (text.length > MAX_TRIGGER_DETAIL ? `${text.slice(0, MAX_TRIGGER_DETAIL - 1)}…` : text);

/** A pull request's status in words, as the run's message says it. A sighting reads its status without the sessions on it, so `answer` and `agent` never show. */
const STATUS_WORDS: Record<MoveId, string> = {
	review: "waits on your review",
	merge: "is ready to merge",
	"fix-ci": "has failing checks",
	rebase: "has conflicts with its base",
	reply: "has comments to address",
	"in-review": "is in review",
	"checks-running": "has checks running",
	draft: "is a draft",
	merged: "was merged",
	answer: "has a session waiting on your answer",
	agent: "has a session working on it",
};

/** Each pull request of the repositories GitHub answered for, by its status: a pull request that shows up, or whose status changes, is a new sighting. */
export function pullRequestSightings(list: PullRequestList): Seen {
	const answered = list.repos.flatMap(repo => ("error" in repo ? [] : [repo]));
	return {
		scopes: answered.map(repo => `pull-request:${repoKey(repo)}`),
		sightings: answered.flatMap(repo =>
			repo.pullRequests.map(pr => {
				const move = moveOf(pr, null);
				const event: TriggerEvent = { kind: "pull-request", title: `${pullRequestName(pr)} ${STATUS_WORDS[move]}`, detail: clip(`${pr.title}, by ${pr.author.login}`), url: pullRequestUrl(pr) };
				return { id: `${prKey(pr)}:${move}`, scope: `pull-request:${repoKey(repo)}`, event };
			}),
		),
	};
}

/** Each Slack conversation's newest message that waits on you; a newer one there is a new sighting. */
export function slackSightings(found: SlackFound[]): Seen {
	return {
		scopes: ["slack"],
		sightings: found.map(message => {
			const title =
				message.type === "mention"
					? `${message.from} mentioned you in ${message.channel}`
					: `${message.from} wrote to you${message.type === "group-dm" ? " in a group message" : ""}${message.count > 1 ? ` (${message.count} messages)` : ""}`;
			return { id: message.id, scope: "slack", event: { kind: "slack", title, detail: clip(message.text), url: message.permalink } };
		}),
	};
}

const timeOfDay = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The timed events of each calendar that answered, `event:local` for this computer's and `event:google/<account>` for a
 * Google account's, that start within {@link EVENT_LEAD_MS} after `now`: an event is a new sighting once, as it comes
 * within that lead, and again if it moves.
 */
export function eventSightings(calendars: { scope: string; events: FoundEvent[] }[], now: number): Seen {
	return {
		scopes: calendars.map(({ scope }) => scope),
		sightings: calendars.flatMap(({ scope, events }) =>
			events
				.filter(event => event.start > now && event.start <= now + EVENT_LEAD_MS)
				.map(event => ({
					id: `${event.ref}:${event.start}`,
					scope,
					event: {
						kind: "event",
						title: `${event.title} starts at ${timeOfDay(event.start)}`,
						detail: clip(`From ${timeOfDay(event.start)} to ${timeOfDay(event.end)}${event.calendar ? `, on ${event.calendar}` : ""}.`),
						url: event.url,
					},
				})),
		),
	};
}
