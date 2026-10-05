import { useEffect, useState } from "react";
import { getJson } from "./api";

export type CwdRead<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The server's answer to `<path>?cwd=<cwd>`, `null` until it first answers for `cwd`, or while `cwd` is `null`. A change
 * of `refresh` reads it again, keeping the last answer meanwhile.
 */
export function useCwdRead<T>(path: string, cwd: string | null, refresh?: unknown): CwdRead<T> | null {
	const [read, setRead] = useState<{ cwd: string; result: CwdRead<T> } | null>(null);
	useEffect(() => {
		if (cwd === null) return;
		const controller = new AbortController();
		getJson<T>(`${path}?cwd=${encodeURIComponent(cwd)}`, controller.signal).then(
			value => setRead({ cwd, result: { ok: true, value } }),
			(err: unknown) => {
				if (!controller.signal.aborted) setRead({ cwd, result: { ok: false, error: err instanceof Error ? err.message : String(err) } });
			},
		);
		return () => controller.abort();
	}, [path, cwd, refresh]);
	return read?.cwd === cwd ? read.result : null;
}
