import { useEffect, useState } from "react";
import type { PullRequest, PullRequestDetail } from "../src/shared";
import { getJson } from "./api";

export interface PullRequestRead {
	detail: PullRequestDetail | null;
	error: string | null;
}

/** `pr` in full from the server, read once. A caller showing another PR, or the same one again, mounts anew (by `key`). */
export function usePullRequest({ owner, repo, number }: PullRequest): PullRequestRead {
	const [read, setRead] = useState<PullRequestRead>({ detail: null, error: null });
	useEffect(() => {
		const controller = new AbortController();
		getJson<PullRequestDetail>(`/api/pull-request?${new URLSearchParams({ owner, repo, number: String(number) })}`, controller.signal)
			.then(
				detail => setRead({ detail, error: null }),
				(err: unknown) => {
					if (!controller.signal.aborted) setRead({ detail: null, error: err instanceof Error ? err.message : String(err) });
				},
			);
		return () => controller.abort();
	}, [owner, repo, number]);
	return read;
}
