/** **Update dashboard**: what `GET` and `PUT /api/dashboard/update` answer. */

/**
 * Whether the server can update itself, and if so where it stands: the branch it follows, the commit it runs, and how
 * many commits `origin/<branch>` holds past it as of the last fetch.
 */
export type DashboardUpdateStatus = { kind: "unavailable"; reason: string } | { kind: "checkout"; branch: string; running: string; behind: number };

/** What an update did: the checkout already held the running commit, or it moved to `to` and the server restarts. */
export type DashboardUpdateOutcome = { kind: "current" } | { kind: "restarting"; from: string; to: string; installed: boolean };
