import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
	/** At the header's end, as the top-right pane puts the right sidebar's toggle. */
	end?: ReactNode;
}

/**
 * The title, an optional meta line, and controls that head a pane or a page.
 * The title keeps at least 16rem beside the controls, or its whole width when shorter; when they would leave it less,
 * they wrap to a right-aligned row of their own under it, as on a phone.
 * The trailing controls take no width until they show, so a title shares its row with them only while they do.
 */
export function Header({ title, meta, status, alert = false, leading, trailing, children, end }: HeaderProps) {
	return (
		<header className="@container/header shrink-0 border-b border-border">
			<div className="flex min-h-(--page-header-height) flex-wrap items-center gap-x-4 px-6 max-phone:px-3">
				<div className="group/reveal flex min-h-(--page-header-height) max-w-max min-w-0 grow basis-64 items-center gap-2">
					{leading}
					<div className="min-w-0">
						<h2 className="truncate text-sm font-semibold">{title}</h2>
						{meta !== undefined && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
					</div>
					{trailing !== undefined && (
						<div className="pointer-events-none flex max-w-0 shrink-0 items-center gap-2 overflow-hidden opacity-0 revealed:pointer-events-auto revealed:max-w-none revealed:overflow-visible revealed:opacity-100">
							{trailing}
						</div>
					)}
				</div>
				<div className="ml-auto flex min-h-10 max-w-full shrink-0 flex-wrap items-center justify-end gap-3 gap-y-2 py-1.5">
					{status !== undefined && (
						<span className={cn("text-xs", alert ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} data-status>
							{status}
						</span>
					)}
					{children}
					{end}
				</div>
			</div>
		</header>
	);
}
