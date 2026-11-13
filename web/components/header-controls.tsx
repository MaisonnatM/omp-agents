/** The Back and Forward buttons at the left end of the header tabs. */
import { IconChevronLeft, IconChevronRight } from "central-icons";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { shortcutLabels } from "../shortcuts";
import { useHistoryPosition } from "../use-history-position";

/** The buttons act through `history`, as the shortcuts do in any browser. */
export function HistoryButtons() {
	const { canGoBack, canGoForward } = useHistoryPosition();
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<Tooltip content="Back" shortcut={shortcutLabels("back")} side="bottom" disabled={!canGoBack}>
				<Button {...activityControl("header.back")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Back" disabled={!canGoBack} onClick={() => history.back()}>
					<IconChevronLeft />
				</Button>
			</Tooltip>
			<Tooltip content="Forward" shortcut={shortcutLabels("forward")} side="bottom" disabled={!canGoForward}>
				<Button {...activityControl("header.forward")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Forward" disabled={!canGoForward} onClick={() => history.forward()}>
					<IconChevronRight />
				</Button>
			</Tooltip>
		</div>
	);
}
