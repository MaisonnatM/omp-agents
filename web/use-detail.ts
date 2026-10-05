import { useCallback, useEffect, useState } from "react";
import { getJson } from "./api";

export interface DetailRead<T> {
	detail: T | null;
	error: string | null;
}

/**
 * The server's answer at `url`, read once, for a sheet's pull request or Linear issue in full, and `replace`, which
 * shows another version of it, such as the one a change answered. A caller showing another item, or the same one
 * again, mounts anew (by `key`).
 */
export function useDetail<T>(url: string): DetailRead<T> & { replace: (detail: T) => void } {
	const [read, setRead] = useState<DetailRead<T>>({ detail: null, error: null });
	useEffect(() => {
		const controller = new AbortController();
		getJson<T>(url, controller.signal).then(
			detail => setRead({ detail, error: null }),
			(err: unknown) => {
				if (!controller.signal.aborted) setRead({ detail: null, error: err instanceof Error ? err.message : String(err) });
			},
		);
		return () => controller.abort();
	}, [url]);
	const replace = useCallback((detail: T) => setRead({ detail, error: null }), []);
	return { ...read, replace };
}
