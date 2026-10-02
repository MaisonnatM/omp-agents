import { useEffect, useRef, useState } from "react";
import type { PullRequest, PullRequestDetail } from "../src/shared";
import { readJson } from "./settings-api";

export interface PullRequestRead {
	detail: PullRequestDetail | null;
	/** Why the latest attempt failed; cleared by the next success. */
	error: string | null;
}

/**
 * `pr` in full from the server, read again whenever `reload` changes, which skips the server's cache. The last answer
 * stays while a newer one loads. A caller showing another PR mounts anew (by `key`), so no answer outlives its PR.
 */
export function usePullRequest({ owner, repo, number }: PullRequest, reload: number): PullRequestRead {
	const [read, setRead] = useState<PullRequestRead>({ detail: null, error: null });
	const firstReload = useRef(reload);
	useEffect(() => {
		const controller = new AbortController();
		const params = new URLSearchParams({ owner, repo, number: String(number) });
		if (reload !== firstReload.current) params.set("fresh", "");
		fetch(`/api/pull-request?${params}`, { signal: controller.signal })
			.then(response => readJson<PullRequestDetail>(response))
			.then(
				detail => setRead({ detail, error: null }),
				(err: unknown) => {
					if (controller.signal.aborted) return;
					setRead(current => ({ ...current, error: err instanceof Error ? err.message : String(err) }));
				},
			);
		return () => controller.abort();
	}, [owner, repo, number, reload]);
	return read;
}
