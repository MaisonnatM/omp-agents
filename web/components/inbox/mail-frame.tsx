import { useEffect, useRef, useState } from "react";

const WEB_LINK = /^(?:https?|mailto):/i;

/**
 * Message `id` of conversation `thread` in a frame that runs none of its scripts, as tall as the message so the page scrolls
 * instead of the frame. The server serves its HTML as a document of its own with its own policy, since a `srcdoc` would
 * inherit the page's, which blocks the message's images. The sandbox keeps `allow-same-origin` and nothing else: without
 * `allow-scripts` the message's code never runs, so the page may reach into the frame to size it, open its links in a new
 * tab, and pass its keys on to the page's shortcuts.
 */
export function MailFrame({ thread, id, title }: { thread: string; id: string; title: string }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const detach = useRef<(() => void) | null>(null);
	const [height, setHeight] = useState(0);
	useEffect(() => () => detach.current?.(), []);

	const onLoad = (): void => {
		detach.current?.();
		const doc = frame.current?.contentDocument;
		const view = doc?.defaultView;
		if (!doc || !view) return;
		const measure = (): void => setHeight(doc.documentElement.scrollHeight);
		const resized = new ResizeObserver(measure);
		resized.observe(doc.documentElement);
		// The frame has no `allow-popups`, so a link would open nowhere; the page opens it instead, with no opener or referrer.
		const onClick = (event: MouseEvent): void => {
			const link = event.target instanceof view.Element ? event.target.closest("a[href]") : null;
			if (!(link instanceof view.HTMLAnchorElement)) return;
			event.preventDefault();
			if (WEB_LINK.test(link.href)) window.open(link.href, "_blank", "noopener,noreferrer");
		};
		// A key pressed after a click inside the message goes to the frame's document, which the page's shortcuts never hear.
		const onKeyDown = (event: KeyboardEvent): void => {
			const { key, code, ctrlKey, altKey, metaKey, shiftKey, repeat } = event;
			const passed = new KeyboardEvent("keydown", { key, code, ctrlKey, altKey, metaKey, shiftKey, repeat, cancelable: true });
			window.dispatchEvent(passed);
			if (passed.defaultPrevented) event.preventDefault();
		};
		doc.addEventListener("click", onClick);
		doc.addEventListener("keydown", onKeyDown);
		measure();
		detach.current = () => {
			resized.disconnect();
			doc.removeEventListener("click", onClick);
			doc.removeEventListener("keydown", onKeyDown);
		};
	};

	return (
		<iframe
			ref={frame}
			title={title}
			sandbox="allow-same-origin"
			referrerPolicy="no-referrer"
			src={`/api/gmail/message?${new URLSearchParams({ thread, id })}`}
			onLoad={onLoad}
			className="block w-full border-0"
			style={{ height }}
		/>
	);
}
