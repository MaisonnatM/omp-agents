/** What Get started shows: its dialog, its bottom-right bubble, or nothing. */
export type GetStartedSurface = "dialog" | "bubble" | "none";

export interface GetStartedFacts {
	/** The URL names `#get-started`. */
	route: boolean;
	/** No page or pane shows. */
	vacantHome: boolean;
	dismissed: boolean;
	/** The dialog was closed once on this computer. */
	minimized: boolean;
	requiredDone: boolean;
	/** The provider count and the first-session fact have answered. */
	settled: boolean;
}

export function getStartedSurface({ route, vacantHome, dismissed, minimized, requiredDone, settled }: GetStartedFacts): GetStartedSurface {
	if (route) return "dialog";
	if (dismissed || requiredDone || !settled) return "none";
	return vacantHome && !minimized ? "dialog" : "bubble";
}
