import type { GitCheckout } from "../src/shared/git";
import { useRead } from "./reads";

/**
 * The git checkout `cwd` is in, `null` outside one and until the server answers. A change of `refresh` reads it again.
 * A failed read keeps the last answer for `cwd`: the new-session draft then starts in `cwd` as it is.
 */
export function useGitCheckout(cwd: string | null, refresh?: unknown): GitCheckout | null {
	return useRead<GitCheckout | null>(cwd === null ? null : `/api/git?cwd=${encodeURIComponent(cwd)}`, refresh).data;
}
