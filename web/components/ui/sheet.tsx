import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { exitFallbackMs, spring } from "@/lib/springs";
import { surfaceClasses } from "@/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/surface-context";
import { cn } from "@/lib/utils";

/** The sheet's accessible name; every sheet's content renders one. */
export const SheetTitle = DialogPrimitive.Title;

interface SheetProps {
	open: boolean;
	onClose: () => void;
	/** Rendered while the sheet shows, so it mounts anew on each opening. It leaves room at the top right for the close button. */
	children: ReactNode;
	className?: string;
}

/**
 * A panel that slides in from the right edge over a scrim, on Radix Dialog for the scroll lock, focus trap, focus
 * restore, and Esc and outside-click dismissal, as the sidebar's mobile sheet does. It stays mounted through its exit
 * slide, so its `children` must keep rendering until the slide ends.
 */
export function Sheet({ open, onClose, children, className }: SheetProps) {
	// Reduced motion drops the slide and keeps the scrim's fade.
	const reduceMotion = useReducedMotion() ?? false;
	const level = Math.min(useSurface() + 2, 8);
	const panelRef = useRef<HTMLDivElement | null>(null);
	/** What had focus when the sheet opened, which gets it back on close: with no Radix trigger, focus would drop to the page. */
	const opener = useRef<HTMLElement | null>(null);
	const [mounted, setMounted] = useState(open);
	useEffect(() => {
		if (open) setMounted(true);
	}, [open]);
	// onAnimationComplete releases the portal; a throttled tab can stall it, so a timer does too.
	useEffect(() => {
		if (open) return;
		const id = setTimeout(() => setMounted(false), exitFallbackMs(spring.moderate));
		return () => clearTimeout(id);
	}, [open]);

	return (
		<DialogPrimitive.Root open={open} onOpenChange={next => !next && onClose()}>
			{mounted && (
				<DialogPrimitive.Portal forceMount>
					<DialogPrimitive.Overlay asChild forceMount>
						<motion.div
							className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80"
							initial={{ opacity: 0 }}
							animate={{ opacity: open ? 1 : 0 }}
							transition={open ? { duration: spring.moderate.duration } : spring.moderate.exit}
						/>
					</DialogPrimitive.Overlay>
					<DialogPrimitive.Content
						asChild
						forceMount
						// The panel takes focus itself: Radix would focus its first link, which then shows a focus ring.
						onOpenAutoFocus={event => {
							event.preventDefault();
							opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
							panelRef.current?.focus();
						}}
						onCloseAutoFocus={event => {
							event.preventDefault();
							opener.current?.focus();
						}}
						aria-describedby={undefined}
					>
						<motion.div
							ref={panelRef}
							tabIndex={-1}
							className={cn("fixed inset-y-0 right-0 z-50 flex w-[min(48rem,calc(100vw-2rem))] flex-col outline-none", surfaceClasses(level, 3), className)}
							initial={{ x: "100%" }}
							animate={{ x: open ? 0 : "100%" }}
							transition={reduceMotion ? { duration: 0 } : open ? spring.moderate : spring.moderate.exit}
							onAnimationComplete={() => {
								if (!open) setMounted(false);
							}}
						>
							<SurfaceProvider value={level}>{children}</SurfaceProvider>
							<DialogPrimitive.Close asChild>
								<Button variant="ghost" size="icon-compact" aria-label="Close" title="Close (Esc)" className="absolute top-3 right-3">
									<X />
								</Button>
							</DialogPrimitive.Close>
						</motion.div>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			)}
		</DialogPrimitive.Root>
	);
}
