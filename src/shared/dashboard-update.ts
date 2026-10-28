/** **Update dashboard**: what `GET` and `PUT /api/dashboard/update` answer. */

/**
 * Whether the server can update itself, and if so where it stands: the branch it follows, the commit it runs, and how
 * many commits `origin/<branch>` holds past it as of the last fetch.
 */
export type DashboardUpdateStatus = { kind: "unavailable"; reason: string } | { kind: "checkout"; branch: string; running: string; behind: number };

/** What an update did: the checkout already held the running commit, or it moved to `to` and the server restarts. */
export type DashboardUpdateOutcome = { kind: "current" } | { kind: "restarting"; from: string; to: string; installed: boolean };

/** One line of `CHANGELOG.md` in the header's What's new: a `- ` bullet under a `## YYYY-MM-DD` heading. */
export interface ChangelogEntry {
	/** The `YYYY-MM-DD` of the heading the line sits under. */
	day: string;
	/** The line without its `- `. */
	text: string;
	/** `false` for a line only `origin/<branch>`'s `CHANGELOG.md` holds, which **Update dashboard** loads. */
	installed: boolean;
}

/** What `GET /api/dashboard/changelog` answers: the lines of `CHANGELOG.md`, newest day first, or why there are none to read. */
export type DashboardChangelog = { kind: "unavailable"; reason: string } | { kind: "checkout"; branch: string; entries: ChangelogEntry[] };
