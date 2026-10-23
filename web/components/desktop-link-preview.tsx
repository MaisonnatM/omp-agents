import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function DesktopLinkPreview() {
	const [url, setURL] = useState("");
	useEffect(() => window.ompDesktop?.onTargetURL?.(setURL), []);
	if (!url) return null;
	return createPortal(
		<div aria-hidden="true" className="pointer-events-none fixed bottom-0 left-0 z-[100] max-w-[100vw] truncate rounded-tr-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground">
			{url}
		</div>,
		document.body,
	);
}
