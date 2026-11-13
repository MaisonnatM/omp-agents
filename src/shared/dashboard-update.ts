/** **Update dashboard**: what `GET` and `PUT /api/dashboard/update` answer. */

/** A commit as git shows it short, by its first seven characters. */
export const shortCommit = (commit: string): string => commit.slice(0, 7);

/** An update whose build did not start, which the desktop shell rolled back: the commit it moved to, and why that build failed. */
export interface FailedUpdate {
	commit: string;
	failure: string;
}

/** "`<commit>` did not start (`<how it ended>`)": how the bell, the command menu, and a refused update name a failed update. */
export const didNotStart = ({ commit, failure }: FailedUpdate): string => `${shortCommit(commit)} did not start (${failure})`;

/**
 * Whether the server can update itself, and if so where it stands: the branch it follows, the commit it runs, how many
 * commits `origin/<branch>` holds past it as of the last fetch, and the update that did not start while origin still
 * holds its commit.
 */
export type DashboardUpdateStatus = { kind: "unavailable"; reason: string } | { kind: "checkout"; branch: string; running: string; behind: number; failed: FailedUpdate | null };

/** What the bell's check finds: origin's commits past the running build. */
export interface DashboardCommits {
	branch: string;
	running: string;
	commits: number;
}

/** The update that did not start while `origin/<branch>` still holds its commit, which the bell tells instead of origin's commits. */
export interface DashboardFailed {
	branch: string;
	running: string;
	failed: FailedUpdate;
}

/** What the bell's check finds past the running build, as the notice kind that tells it. */
export type DashboardNews = ({ kind: "dashboard" } & DashboardCommits) | ({ kind: "dashboard-failed" } & DashboardFailed);

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
