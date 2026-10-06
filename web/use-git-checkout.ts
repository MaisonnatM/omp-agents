import type { GitCheckout } from "../src/shared/git";
import { useRead } from "./reads";

/**
 * The git checkout `cwd` is in, `null` outside one and until the server answers. A change of `refresh` reads it again,
 * as a session can switch branches during a turn. A failed read keeps the last answer for `cwd`: the header then leaves
 * the repository out, and the new-session draft starts in `cwd` as it is.
 */
export const useGitCheckout = (cwd: string | null, refresh?: unknown): GitCheckout | null =>
	useRead<GitCheckout | null>(cwd === null ? null : `/api/git?cwd=${encodeURIComponent(cwd)}`, refresh).data;
