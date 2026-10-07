import { createContext, useContext, useMemo } from "react";
import type { GitCheckout } from "../src/shared/git";
import { useRead } from "./reads";

/** Counts the branch switches made from this page, so every read of a checkout reads it again after one. */
export const CheckoutVersion = createContext(0);

/** A version that changes with `refresh` and with every branch switch made from this page. */
export function useCheckoutVersion(refresh?: unknown): object {
	const switches = useContext(CheckoutVersion);
	return useMemo(() => ({}), [refresh, switches]);
}

/**
 * The git checkout `cwd` is in, `null` outside one and until the server answers. A change of `refresh`, or a branch
 * switch from the status bar, reads it again, as a session can switch branches during a turn. A failed read keeps the
 * last answer for `cwd`: the header then leaves the repository out, and the new-session draft starts in `cwd` as it is.
 */
export function useGitCheckout(cwd: string | null, refresh?: unknown): GitCheckout | null {
	const version = useCheckoutVersion(refresh);
	return useRead<GitCheckout | null>(cwd === null ? null : `/api/git?cwd=${encodeURIComponent(cwd)}`, version).data;
}
