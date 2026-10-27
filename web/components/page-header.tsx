import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useHeaderControls } from "./header-controls";

interface HeaderProps {
	title: ReactNode;
	/** A line under the title; a header without one centers its title. */
	meta?: ReactNode;
	status?: string;
	alert?: boolean;
	/** A control before the title, such as a subagent's way back to its session. */
	leading?: ReactNode;
	/** Controls right after the title, such as the switch to a session's trajectory, shown while the pointer is over the title or one of them has focus, and always on a touch screen. */
	trailing?: ReactNode;
	children?: ReactNode;
	/** After the command menu and the bell, at the header's end, as the top-right pane puts the right sidebar's toggle. */
	end?: ReactNode;
}

/** The title, an optional meta line, and controls that head a pane or a page, ending with the command menu and the bell. */
export function Header({ title, meta, status, alert = false, leading, trailing, children, end }: HeaderProps) {
	const controls = useHeaderControls();
	return (
		<header className="flex h-(--page-header-height) shrink-0 items-center justify-between gap-4 border-b border-border px-6">
			<div className="group/title flex min-w-0 items-center gap-2">
				{leading}
				<div className="min-w-0">
					<h2 className="truncate text-sm font-semibold">{title}</h2>
					{meta !== undefined && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
				</div>
				{trailing !== undefined && (
					<div className="pointer-events-none flex shrink-0 items-center gap-2 opacity-0 group-focus-within/title:pointer-events-auto group-focus-within/title:opacity-100 group-hover/title:pointer-events-auto group-hover/title:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
						{trailing}
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-3">
				{status !== undefined && (
					<span className={cn("text-xs", alert ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} data-status>
						{status}
					</span>
				)}
				{children}
				{controls}
				{end}
			</div>
		</header>
	);
}
