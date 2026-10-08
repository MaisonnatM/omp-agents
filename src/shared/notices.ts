/** What the bell lists: a newer omp, or a newer version of a model omp's routing names. */

export interface NamedModel {
	id: string;
	/** omp's name for it, such as `Claude Opus 5.6`. */
	name: string;
}

/** A model the routing names, `from`, and its newest version on the same provider, `to`. */
export interface ModelUpdate {
	provider: string;
	from: NamedModel;
	to: NamedModel;
	/** Where the routing names `from`: a role, such as `default`, or a fallback chain, as `smol fallbacks`. */
	uses: string[];
}

const USES = new Intl.ListFormat("en", { type: "conjunction" });

/** `uses` as a sentence's subject and verb: `plan and default fallbacks use`, `smol uses`. */
export const usesClause = (uses: string[]): string => `${USES.format(uses)} ${uses.length === 1 ? "uses" : "use"}`;

export type NoticeStatus =
	| { state: "available" }
	| { state: "updating" }
	| { state: "updated"; note: string }
	| { state: "failed"; error: string };

/** What a notice offers: an omp release newer than the one installed, or a newer version of a routed model. */
export type NoticeSubject = { kind: "omp"; current: string; latest: string } | ({ kind: "model" } & ModelUpdate);

/**
 * One update the user can take. The id names the versions, so a newer release is a new notice even after the last one was
 * cleared. `seen` is set once the user dismissed its toast or started its update, so it shows as a toast only once.
 */
export type Notice = { id: string; seen: boolean; status: NoticeStatus } & NoticeSubject;

/** `update` installs the release or rewrites the routing; `seen` stops its toast; `clear` hides it until a newer version. */
export const NOTICE_OPS = ["update", "seen", "clear"] as const;
export type NoticeOp = (typeof NOTICE_OPS)[number];
