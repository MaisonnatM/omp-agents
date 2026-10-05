/** Pull request links and the inbox page's sections. */
import type { InboxPullRequest, PullRequest } from "../src/shared";
import { type SectionTarget, sectionId } from "./section";

export const graphiteUrl = (pr: PullRequest): string => `https://app.graphite.com/github/pr/${pr.owner}/${pr.repo}/${pr.number}`;

/** Graphite's inbox sections, in page order. A pull request goes in the first section that takes it. */
const INBOX_SECTIONS: [title: string, takes: (pr: InboxPullRequest) => boolean][] = [
	["Needs your review", pr => pr.role === "reviewer" && pr.state !== "merged"],
	["Returned to you", pr => pr.state === "open" && pr.review === "changes-requested"],
	["Approved", pr => pr.state === "open" && pr.review === "approved"],
	["Waiting for review", pr => pr.state === "open"],
	["Drafts", pr => pr.state === "draft"],
	["Recently merged", pr => pr.state === "merged"],
];

export interface InboxSection {
	title: string;
	/** Most recently updated first. */
	pullRequests: InboxPullRequest[];
}

/** A repository's pull requests in Graphite's inbox sections, leaving out the empty ones. */
export function inboxSections(pullRequests: InboxPullRequest[]): InboxSection[] {
	const sections = INBOX_SECTIONS.map(([title]): InboxSection => ({ title, pullRequests: [] }));
	for (const pr of pullRequests.toSorted((a, b) => b.updatedAt - a.updatedAt)) {
		sections[INBOX_SECTIONS.findIndex(([, takes]) => takes(pr))]?.pullRequests.push(pr);
	}
	return sections.filter(section => section.pullRequests.length > 0);
}

/** A section of the inbox page, by `repoKey` and title, which a sidebar link scrolls to. Its title is folded under the repository. */
export const inboxSection = (repo: string, title: string): SectionTarget => ({
	id: sectionId("inbox", repo, title),
	folds: [repo, `${repo}:${title}`],
});
