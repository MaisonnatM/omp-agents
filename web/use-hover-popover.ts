import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from "react";

/** How long the pointer may be off both the trigger and the popover before a hover-opened popover closes. */
const CLOSE_MS = 120;

/**
 * A popover a mouse opens by hovering its trigger and a click or the keyboard opens as usual. A hover-opened popover
 * keeps focus where it was and closes once the pointer leaves both the trigger and the content, unless focus is inside;
 * a click on the trigger while it shows moves focus to the content's first button, so its actions are reachable by keyboard.
 */
export function useHoverPopover<Trigger extends HTMLElement = HTMLButtonElement>() {
	const [open, setOpen] = useState(false);
	const hovered = useRef(false);
	const trigger = useRef<Trigger>(null);
	const content = useRef<HTMLDivElement>(null);
	const closeTimer = useRef<number | undefined>(undefined);
	const keepOpen = () => window.clearTimeout(closeTimer.current);
	const closeAfterHover = () => {
		keepOpen();
		closeTimer.current = window.setTimeout(() => {
			if (trigger.current === document.activeElement || content.current?.contains(document.activeElement)) return;
			setOpen(false);
		}, CLOSE_MS);
	};
	useEffect(() => keepOpen, []);
	return {
		root: {
			open,
			onOpenChange: (value: boolean) => {
				keepOpen();
				hovered.current = false;
				setOpen(value);
			},
		},
		trigger: {
			ref: trigger,
			onPointerEnter: (event: PointerEvent) => {
				keepOpen();
				if (event.pointerType === "mouse" && !open) {
					hovered.current = true;
					setOpen(true);
				}
			},
			onPointerLeave: closeAfterHover,
			onClick: (event: MouseEvent) => {
				if (!hovered.current) return;
				event.preventDefault();
				hovered.current = false;
				content.current?.querySelector("button")?.focus();
			},
		},
		content: {
			ref: content,
			onPointerEnter: keepOpen,
			onPointerLeave: closeAfterHover,
			onOpenAutoFocus: (event: Event) => {
				if (hovered.current) event.preventDefault();
			},
			onCloseAutoFocus: (event: Event) => {
				if (hovered.current) event.preventDefault();
			},
			onEscapeKeyDown: () => {
				hovered.current = false;
			},
		},
	};
}
