/**
 * What routines' triggers see: the pull requests, Slack messages, and calendar events the bell's checks read, and the
 * Gmail inboxes the Email page reads, turned into sightings, and the watch that tells which sightings are new since the
 * last answer for their scope.
 */
import { MAX_TRIGGER_DETAIL, type TriggerEvent } from "../routines";
import type { EmailAnswer } from "../shared/gmail";
import { prKey, pullRequestName, pullRequestUrl, type PullRequestList, repoKey } from "../shared/github";
import { type AgentOn, type YourMove, yourMoves } from "../shared/moves";
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

	/** Forgets `scope`'s last answer, so its next answer is a baseline, as when its source signs out. */
	forgetScope(scope: string): void {
		this.#known.delete(scope);
	}
}

const clip = (text: string): string => (text.length > MAX_TRIGGER_DETAIL ? `${text.slice(0, MAX_TRIGGER_DETAIL - 1)}…` : text);

/** A pull request's move in words, as the run's message says it. */
const MOVE_WORDS: Record<YourMove, string> = {
	review: "waits on your review",
	merge: "is ready to merge",
	"fix-ci": "has failing checks",
	rebase: "has conflicts with its base",
	reply: "has comments to address",
};

/**
 * Each pull request of the repositories GitHub answered for whose next move is yours, by that move, read with the
 * sessions on it as the bell reads it: a pull request whose move becomes yours, or changes to another of yours, is a new
 * sighting. A draft, checks still running, or a session at work on it is none, so a Bot's own push fires nothing until
 * it ends in a move of yours.
 */
export function pullRequestSightings(list: PullRequestList, agent: AgentOn): Seen {
	const { answered, yours } = yourMoves(list, agent);
	return {
		scopes: answered.map(repo => `pull-request:${repoKey(repo)}`),
		sightings: yours.map(({ repo, pr, move }) => ({
			id: `${prKey(pr)}:${move}`,
			scope: `pull-request:${repoKey(repo)}`,
			event: { kind: "pull-request", title: `${pullRequestName(pr)} ${MOVE_WORDS[move]}`, detail: clip(`${pr.title}, by ${pr.author.login}`), url: pullRequestUrl(pr) },
		})),
	};
}

/** The scope of the Slack check's answer, which the check forgets while Slack is signed out. */
export const SLACK_SCOPE = "slack";

/** Each Slack conversation's newest message that waits on you; a newer one there is a new sighting. */
export function slackSightings(found: SlackFound[]): Seen {
	return {
		scopes: [SLACK_SCOPE],
		sightings: found.map(message => {
			const title =
				message.type === "mention"
					? `${message.from} mentioned you in ${message.channel}`
					: `${message.from} wrote to you${message.type === "group-dm" ? " in a group message" : ""}${message.count > 1 ? ` (${message.count} messages)` : ""}`;
			return { id: message.id, scope: SLACK_SCOPE, event: { kind: "slack", title, detail: clip(message.text), url: message.permalink } };
		}),
	};
}

/** Each unread conversation of the Gmail inboxes that answered, by its last message: new mail, there or in a conversation of its own, is a new sighting. */
export function gmailSightings(answer: EmailAnswer): Seen {
	const scope = (account: string): string => `gmail:${account}`;
	return {
		scopes: answer.accounts.flatMap(({ account, error }) => (error === null ? [scope(account)] : [])),
		sightings: answer.threads
			.filter(thread => thread.unread)
			.map(({ account, id, at, from, subject, snippet, url }) => ({
				id: `${account}:${id}:${at}`,
				scope: scope(account),
				event: { kind: "gmail", title: `${from} wrote: ${subject || "(no subject)"}`, detail: clip(snippet), url },
			})),
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
