/** A panel that slides over a page's content from the trailing edge, as the Project memory tab's editor does. */
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

interface DrawerProps {
	open: boolean;
	/** The drawer's accessible name. */
	label: string;
	onClose: () => void;
	/** Where the focus goes back to as the drawer closes, such as the row it opened; `null` leaves it where it is. */
	returnFocus: () => HTMLElement | null;
	/** What the drawer covers, inert while it is open. */
	content: ReactNode;
	children: ReactNode;
}

/**
 * `content`, with `children` in a drawer over it while `open`: the focus moves into the drawer as it opens and back to
 * `returnFocus()` as it closes, and Escape or a click beside the drawer calls `onClose`.
 */
export function Drawer({ open, label, onClose, returnFocus, content, children }: DrawerProps) {
	const panel = useRef<HTMLElement>(null);
	const latest = useRef({ onClose, returnFocus });
	useLayoutEffect(() => {
		latest.current = { onClose, returnFocus };
	});
	useEffect(() => {
		if (!open) return;
		if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
		const onKey = (event: KeyboardEvent) => {
			if (!event.defaultPrevented && event.key === "Escape") latest.current.onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			const target = latest.current.returnFocus();
			if (target?.isConnected) target.focus({ preventScroll: true });
		};
	}, [open]);
	return (
		<div className="relative min-h-0 flex-1">
			<div inert={open} className="h-full overflow-auto">
				{content}
			</div>
			{open && (
				<>
					<button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 z-10 cursor-default bg-background/40 motion-safe:animate-in motion-safe:fade-in-0" />
					<aside
						ref={panel}
						tabIndex={-1}
						aria-label={label}
						className="absolute inset-y-0 right-0 z-20 w-[min(36rem,100%)] overflow-y-auto border-l border-border bg-background shadow-surface-4 outline-none motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-right-8"
					>
						{children}
					</aside>
				</>
			)}
		</div>
	);
}
