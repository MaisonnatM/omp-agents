/** `WindowHeader`, the row across the top of the page and the details sidebar, and its Back and Forward buttons. */
import { IconChevronLeftSmall, IconChevronRightSmall } from "central-icons";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { shortcutLabels } from "../shortcuts";
import { goInHistory, useWindowHistory } from "../window-history";

/** The buttons move through the window's history, as the shortcuts and the mouse's buttons do. */
export function HistoryButtons() {
	const { canGoBack, canGoForward } = useWindowHistory();
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<Tooltip content="Back" shortcut={shortcutLabels("back")} side="bottom" disabled={!canGoBack}>
				<Button {...activityControl("header.back")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Back" disabled={!canGoBack} onClick={() => goInHistory(-1)}>
					<IconChevronLeftSmall />
				</Button>
			</Tooltip>
			<Tooltip content="Forward" shortcut={shortcutLabels("forward")} side="bottom" disabled={!canGoForward}>
				<Button {...activityControl("header.forward")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Forward" disabled={!canGoForward} onClick={() => goInHistory(1)}>
					<IconChevronRightSmall />
				</Button>
			</Tooltip>
		</div>
	);
}

/** The window's top row, which drags the desktop window and shows Back and Forward while the sidebar does not hold them. */
export function WindowHeader({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"flex h-(--window-header-height) min-w-0 items-center gap-1 select-none [-webkit-app-region:drag] *:[-webkit-app-region:no-drag]",
				// A closed sidebar's toggle sits over the row's left end, past the desktop window's buttons.
				"phone:group-has-[#sessions-sidebar[inert]]/window:pl-[calc(env(titlebar-area-x,0px)+var(--sidebar-toggle-clearance))] max-phone:pl-[max(var(--sidebar-toggle-clearance),env(titlebar-area-x,0px))]",
				className,
			)}
		>
			{/* A docked open sidebar holds these at its right edge instead (`DashboardSidebar`). */}
			<div className="contents phone:group-has-[#sessions-sidebar:not([inert])]/window:hidden">
				<HistoryButtons />
			</div>
		</div>
	);
}
