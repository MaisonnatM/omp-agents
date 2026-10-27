/** **Update dashboard**: what `GET` and `PUT /api/dashboard/update` answer. */

/**
 * Whether the server can update itself, and if so where it stands: the branch it follows, the commit it runs, and how
 * many commits `origin/<branch>` holds past it as of the last fetch.
 */
export type DashboardUpdateStatus = { kind: "unavailable"; reason: string } | { kind: "checkout"; branch: string; running: string; behind: number };

/** What an update did: the checkout already held the running commit, or it moved to `to` and the server restarts. */
export type DashboardUpdateOutcome = { kind: "current" } | { kind: "restarting"; from: string; to: string; installed: boolean };

/** One feature commit in Settings › What's new: a `feat:` or `Add ...` subject, read without its prefix. */
export interface ChangelogEntry {
	commit: string;
	/** Commit time, in ms. */
	at: number;
	/** The subject without its `feat(area):` prefix or ` (#N)` suffix, capitalized. */
	title: string;
	/** The `feat(area)` scope, or `null`. */
	area: string | null;
	/** The pull request the ` (#N)` suffix names, or `null`. */
	pr: number | null;
	/** `false` for a commit on `origin/<branch>` the running build lacks, which **Update dashboard** loads. */
	installed: boolean;
}

/** What `GET /api/dashboard/changelog` answers: the newest feature commits first, or why there are none to read. */
export type DashboardChangelog = { kind: "unavailable"; reason: string } | { kind: "checkout"; branch: string; entries: ChangelogEntry[] };
