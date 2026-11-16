/** The Back and Forward buttons at the left end of the header tabs. */
import { IconChevronLeft, IconChevronRightSmall } from "central-icons";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { goInHeaderTab, useHeaderTabHistory } from "../header-tab-history";
import { shortcutLabels } from "../shortcuts";

/** The buttons move through the history of the header tab on screen, as the shortcuts and the mouse's buttons do. */
export function HistoryButtons() {
	const { canGoBack, canGoForward } = useHeaderTabHistory();
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<Tooltip content="Back" shortcut={shortcutLabels("back")} side="bottom" disabled={!canGoBack}>
				<Button {...activityControl("header.back")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Back" disabled={!canGoBack} onClick={() => goInHeaderTab(-1)}>
					<IconChevronLeft />
				</Button>
			</Tooltip>
			<Tooltip content="Forward" shortcut={shortcutLabels("forward")} side="bottom" disabled={!canGoForward}>
				<Button {...activityControl("header.forward")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Forward" disabled={!canGoForward} onClick={() => goInHeaderTab(1)}>
					<IconChevronRightSmall />
				</Button>
			</Tooltip>
		</div>
	);
}
