/** The command menu button and the notices' bell: in the desktop app's title bar, else at the end of the page's header. */
import { Search } from "lucide-react";
import { createContext, memo, type ReactNode, useContext } from "react";
import type { Notice } from "../../src/shared/notices";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { shortcutLabels } from "../shortcuts";
import { NoticesBell } from "./notices";

/** The desktop app on macOS hides the system's title bar, so the page draws it, `DesktopTitleBar`, with these controls. */
export const DESKTOP_TITLE_BAR = typeof window !== "undefined" && window.ompDesktop?.titleBar === true;

/** What every `Header` ends with: `null` under the desktop title bar; a pane provides `null` and puts them before its sidebar toggle, in the top right pane only. */
export const HeaderControlsContext = createContext<ReactNode>(null);

export const useHeaderControls = (): ReactNode => useContext(HeaderControlsContext);

export const HeaderControls = memo(function HeaderControls({ notices, onShowSearch }: { notices: Notice[]; onShowSearch: () => void }) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<Tooltip content="Command menu" shortcut={shortcutLabels("switcher")} side="bottom">
				<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="Command menu" onClick={onShowSearch}>
					<Search />
				</Button>
			</Tooltip>
			<NoticesBell notices={notices} />
		</div>
	);
});

/** The window's title bar: a drag strip with the window's buttons inset at its left, the document title centered, and the controls at its right. */
export function DesktopTitleBar({ title, controls }: { title: string; controls: ReactNode }) {
	return (
		<div className="relative flex h-9 shrink-0 items-center justify-end border-b border-border bg-sidebar px-3 select-none [-webkit-app-region:drag]">
			<p className="pointer-events-none absolute inset-x-40 truncate text-center text-[13px] font-medium text-muted-foreground">{title}</p>
			<div className="[-webkit-app-region:no-drag]">{controls}</div>
		</div>
	);
}
