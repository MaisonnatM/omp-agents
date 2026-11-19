/** A Linear issue as the session's Linear tab shows it, read through omp's Linear MCP server, and the issue ids a session's messages name. */

export interface LinearIssue {
	/** Its identifier, a team key and a number, such as `ENG-123`. */
	id: string;
	title: string;
	url: string;
	/** Its workflow state's name, such as `In Progress`. */
	status: string;
	/** Linear's type of that state: `triage`, `backlog`, `unstarted`, `started`, `completed`, or `canceled`. */
	statusType: string;
	/** Its priority's name, such as `High`; `null` for no priority. */
	priority: string | null;
	assignee: string | null;
	project: string | null;
	team: string | null;
	labels: string[];
	/** Its description in Markdown; empty when it has none. */
	description: string;
	/** When it last changed, as an ISO date. */
	updatedAt: string;
}

const ISSUE_ID = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/;
const ISSUE_URL = /https:\/\/linear\.app\/[\w-]+\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d+)/g;

/** The issue id `input` names, as an id such as `eng-123` or an issue's link, upper-cased; `null` for anything else. */
export function linearIssueId(input: string): string | null {
	const text = input.trim();
	const id = ISSUE_ID.test(text) ? text : ([...text.matchAll(ISSUE_URL)][0]?.[1] ?? null);
	return id && id.toUpperCase();
}

/** The ids of the Linear issues `texts` link to, each once, in the order they first appear. */
export function linearIssueIdsIn(texts: readonly string[]): string[] {
	const ids = new Set<string>();
	for (const text of texts) {
		if (!text.includes("linear.app/")) continue;
		for (const [, id] of text.matchAll(ISSUE_URL)) if (id) ids.add(id.toUpperCase());
	}
	return [...ids];
}
