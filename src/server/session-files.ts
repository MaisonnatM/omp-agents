/** Every session file on disk, newest first, with the pull requests each session worked on. */
import { repoOf } from "../inbox";
import { listSessionFiles, type SavedSession } from "../omp/sessions";
import { displayPath } from "../paths";
import { PullRequestIndex } from "../pull-requests";
import type { LinkedPullRequest, PastSession } from "../shared";

export class SessionFiles {
	#files: SavedSession[] = [];
	#byId = new Map<string, SavedSession>();
	readonly pullRequests = new PullRequestIndex(repoOf);

	/** The file of session `sessionId`, or `null` while it is not listed. */
	readonly pathOf = (sessionId: string): string | null => this.#byId.get(sessionId)?.path ?? null;

	/** What the pull-request index knows of session `sessionId`'s transcript. */
	readonly pullRequestsOf = (sessionId: string): LinkedPullRequest[] => {
		const path = this.pathOf(sessionId);
		return path ? this.pullRequests.of(path) : [];
	};

	/** Directories sessions ran in, newest first. Sessions from old omp versions recorded none. */
	cwds(): string[] {
		return this.#files.map(session => session.cwd).filter(Boolean);
	}

	/** List the files again. */
	async scan(): Promise<void> {
		this.#files = await listSessionFiles();
		this.#byId = new Map(this.#files.map(file => [file.id, file]));
	}

	/** Read the transcripts for the pull requests they touched; whether any link changed. The first read covers every transcript. */
	linkPullRequests(): Promise<boolean> {
		return this.pullRequests.refresh(this.#files);
	}

	/** The saved sessions that no live session continues, newest first. */
	past(liveSessionIds: ReadonlySet<string>): PastSession[] {
		return this.#files
			.filter(session => !session.empty && !liveSessionIds.has(session.id))
			.map(session => ({
				sessionId: session.id,
				title: session.title,
				cwd: session.cwd,
				cwdDisplay: displayPath(session.cwd),
				modifiedAt: session.modifiedAt,
				pullRequests: this.pullRequests.of(session.path),
			}));
	}
}
