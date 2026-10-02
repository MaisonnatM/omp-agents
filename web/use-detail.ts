import { useEffect, useState } from "react";
import { getJson } from "./api";

export interface DetailRead<T> {
	detail: T | null;
	error: string | null;
}

/**
 * The server's answer at `url`, read once, for a sheet's pull request or Linear issue in full. A caller showing another
 * item, or the same one again, mounts anew (by `key`).
 */
export function useDetail<T>(url: string): DetailRead<T> {
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
	return read;
}
