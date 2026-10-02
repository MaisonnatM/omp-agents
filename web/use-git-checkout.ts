import { useEffect, useState } from "react";
import type { GitCheckout } from "../src/shared";
import { getJson } from "./api";

/**
 * The git checkout `cwd` is in, `null` outside one and until the server answers. A change of `refresh` reads it again,
 * as a session can switch branches during a turn. A failed read keeps the last answer for `cwd`: the header then leaves
 * the repository out, and the new-session draft starts in `cwd` as it is.
 */
export function useGitCheckout(cwd: string | null, refresh?: unknown): GitCheckout | null {
	const [read, setRead] = useState<{ cwd: string; checkout: GitCheckout | null } | null>(null);
	useEffect(() => {
		if (cwd === null) return;
		const controller = new AbortController();
		getJson<GitCheckout | null>(`/api/git?cwd=${encodeURIComponent(cwd)}`, controller.signal).then(
			checkout => setRead({ cwd, checkout }),
			() => {},
		);
		return () => controller.abort();
	}, [cwd, refresh]);
	return read?.cwd === cwd ? read.checkout : null;
}
