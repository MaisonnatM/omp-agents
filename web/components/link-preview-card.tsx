/** The card over a link to another site, shown while the pointer rests on it or keyboard focus reaches it: the site, the page's title and description, and the address. */
import { useEffect, useState } from "react";
import type { LinkPreview } from "../../src/shared/link-preview";
import { getJson } from "../api";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { labelOf, SiteIcon } from "./sources-section";

const OPEN_DELAY_MS = 400;

const previews = new Map<string, Promise<LinkPreview | null>>();
function previewOf(url: string): Promise<LinkPreview | null> {
	let preview = previews.get(url);
	if (!preview) {
		preview = getJson<LinkPreview | null>(`/api/link-preview?${new URLSearchParams({ url })}`).catch(() => null);
		previews.set(url, preview);
	}
	return preview;
}

/** The link to another site that `target` sits in; a link with a tooltip or hover card of its own (Radix marks it `data-state`) keeps that one. */
function outsideLink(target: EventTarget | null): HTMLAnchorElement | null {
	const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
	if (!link || link.hasAttribute("data-state")) return null;
	const url = URL.parse(link.href);
	return url && (url.protocol === "https:" || url.protocol === "http:") && url.origin !== location.origin ? link : null;
}

/** A link the card shows over, with what its page says once read. */
type Shown = { link: HTMLAnchorElement; preview: LinkPreview | null };

export function LinkPreviewCard() {
	const [shown, setShown] = useState<Shown | null>(null);
	useEffect(() => {
		let target: HTMLAnchorElement | null = null;
		let timer = 0;
		// The read runs during the dwell, so the card opens at its final size.
		const show = (next: HTMLAnchorElement, delay: number) => {
			if (next === target) return;
			target = next;
			clearTimeout(timer);
			const read = previewOf(next.href);
			timer = window.setTimeout(() => void read.then(preview => target === next && setShown({ link: next, preview })), delay);
		};
		const hide = () => {
			target = null;
			clearTimeout(timer);
			setShown(null);
		};
		const over = (event: PointerEvent) => {
			const next = event.pointerType === "touch" ? null : outsideLink(event.target);
			if (next) show(next, OPEN_DELAY_MS);
		};
		const out = (event: PointerEvent) => {
			if (target && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) hide();
		};
		const focus = (event: FocusEvent) => {
			const next = outsideLink(event.target);
			if (next?.matches(":focus-visible")) show(next, 0);
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") hide();
		};
		document.addEventListener("pointerover", over);
		document.addEventListener("pointerout", out);
		document.addEventListener("focusin", focus);
		document.addEventListener("focusout", hide);
		document.addEventListener("pointerdown", hide, true);
		document.addEventListener("keydown", key);
		document.addEventListener("scroll", hide, true);
		window.addEventListener("blur", hide);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("pointerover", over);
			document.removeEventListener("pointerout", out);
			document.removeEventListener("focusin", focus);
			document.removeEventListener("focusout", hide);
			document.removeEventListener("pointerdown", hide, true);
			document.removeEventListener("keydown", key);
			document.removeEventListener("scroll", hide, true);
			window.removeEventListener("blur", hide);
		};
	}, []);
	if (!shown) return null;
	const { link, preview } = shown;
	return (
		<Popover open onOpenChange={open => !open && setShown(null)}>
			<PopoverAnchor virtualRef={{ current: link }} />
			<PopoverContent
				key={link.href}
				aria-hidden="true"
				side="bottom"
				align="start"
				sideOffset={6}
				collisionPadding={8}
				onOpenAutoFocus={event => event.preventDefault()}
				onCloseAutoFocus={event => event.preventDefault()}
				className="pointer-events-none w-80 max-w-[calc(100vw-1rem)] origin-(--radix-popover-content-transform-origin) p-3 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none"
			>
				<Body href={link.href} preview={preview} />
			</PopoverContent>
		</Popover>
	);
}

/** The site, title, and description when the page was read, then the whole address, its scheme shown when it is not HTTPS. */
function Body({ href, preview }: { href: string; preview: LinkPreview | null }) {
	const { hostname, host, rest } = labelOf(href);
	const scheme = href.startsWith("http:") ? "http://" : "";
	const address = (
		<span className="line-clamp-3 min-w-0 break-all">
			<span className={preview ? undefined : "text-foreground"}>
				{scheme}
				{host}
			</span>
			{rest}
		</span>
	);
	if (!preview) {
		return (
			<p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
				<SiteIcon hostname={hostname} />
				{address}
			</p>
		);
	}
	return (
		<>
			<p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<SiteIcon hostname={hostname} />
				<span className="truncate">{preview.site ?? host}</span>
			</p>
			<p className="mt-1.5 line-clamp-2 text-sm font-medium">{preview.title}</p>
			{preview.description && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{preview.description}</p>}
			<p className="mt-1.5 text-xs text-muted-foreground">{address}</p>
		</>
	);
}
