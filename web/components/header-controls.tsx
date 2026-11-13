/** What's new, the notices' bell, and Settings, at the right end of the header tabs; and the Back and Forward buttons at their left end. */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { memo } from "react";
import type { Notice } from "../../src/shared/notices";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { PAGE_ICON } from "../page-icons";
import { shortcutLabels } from "../shortcuts";
import { useHistoryPosition } from "../use-history-position";
import { NoticesBell } from "./notices";
import { WhatsNew } from "./whats-new";

interface HeaderControlsProps {
	notices: Notice[];
	settingsOpen: boolean;
	onToggleSettings: () => void;
}

const SettingsIcon = PAGE_ICON.settings;

export const HeaderControls = memo(function HeaderControls({ notices, settingsOpen, onToggleSettings }: HeaderControlsProps) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<WhatsNew />
			<NoticesBell notices={notices} />
			<Tooltip content={settingsOpen ? "Close settings" : "Settings"} shortcut={shortcutLabels("settings")} side="bottom">
				<Button
					{...activityControl("header.settings")}
					variant="ghost"
					size="icon-compact"
					className="shrink-0 text-muted-foreground aria-pressed:bg-selected aria-pressed:text-foreground"
					aria-label="Settings"
					aria-pressed={settingsOpen}
					onClick={onToggleSettings}
				>
					<SettingsIcon />
				</Button>
			</Tooltip>
		</div>
	);
});

/** The buttons act through `history`, as the shortcuts do in any browser. */
export function HistoryButtons() {
	const { canGoBack, canGoForward } = useHistoryPosition();
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<Tooltip content="Back" shortcut={shortcutLabels("back")} side="bottom" disabled={!canGoBack}>
				<Button {...activityControl("header.back")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Back" disabled={!canGoBack} onClick={() => history.back()}>
					<ChevronLeft />
				</Button>
			</Tooltip>
			<Tooltip content="Forward" shortcut={shortcutLabels("forward")} side="bottom" disabled={!canGoForward}>
				<Button {...activityControl("header.forward")} variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Forward" disabled={!canGoForward} onClick={() => history.forward()}>
					<ChevronRight />
				</Button>
			</Tooltip>
		</div>
	);
}
