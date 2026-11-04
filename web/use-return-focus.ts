import { useRef } from "react";

/** The element `useReturnFocus` is focusing, only while its `focus()` call runs. */
let returning: Element | null = null;

/** Whether this focus is a dialog handing the focus back, which `Tooltip` lets pass without opening, so one Escape still closes what is under it. */
export const isReturnedFocus = (element: Element): boolean => element === returning;

/**
 * The `onCloseAutoFocus` of a dialog shown without a Radix trigger: as it closes, the focus goes back to what had it as
 * the dialog opened, such as the file row or the image a click opened it from, while that is still on the page.
 * Radix would focus its trigger, and without one the page's body, so Tab and the arrow keys would start over at the top.
 */
export function useReturnFocus(): (event: Event) => void {
	const opener = useRef(document.activeElement);
	return event => {
		const element = opener.current;
		if (!(element instanceof HTMLElement) || !element.isConnected) return;
		event.preventDefault();
		returning = element;
		try {
			element.focus({ preventScroll: true });
		} finally {
			returning = null;
		}
	};
}
