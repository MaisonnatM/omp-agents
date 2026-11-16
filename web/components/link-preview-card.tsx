/**
 * The card over a link to another site, shown once the pointer rests on it or keyboard focus reaches it: the address
 * at once, then the site, the page's title and description when the server reads them.
 * Nothing is read before the card shows, and never for a link in agent text (`data-link-preview="address"`), whose
 * address a prompt-injected agent could have written a secret into; that card shows the address with a globe.
 */
import { useEffect, useState } from "react";
import type { LinkPreview } from "../../src/shared/link-preview";
import { getJson } from "../api";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { addressParts, SiteAddress, SiteIcon } from "./site-icon";

const OPEN_DELAY_MS = 400;

/**
 * The link to another site that `target` sits in. A link with a Radix tooltip or hover card of its own, which marks
 * its trigger `data-state`, keeps that one instead, as the Overview's Sources rows do.
 */
function outsideLink(target: EventTarget | null): HTMLAnchorElement | null {
	const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
	if (!link || link.hasAttribute("data-state")) return null;
	const url = URL.parse(link.href);
	return url && (url.protocol === "https:" || url.protocol === "http:") && url.origin !== location.origin ? link : null;
}

/** The outside link the pointer has rested on for `OPEN_DELAY_MS`, or that keyboard focus reached, until the pointer or focus leaves it, a click, Escape, or a scroll around it. */
function useRestedLink(): HTMLAnchorElement | null {
	const [rested, setRested] = useState<HTMLAnchorElement | null>(null);
	useEffect(() => {
		const listening = new AbortController();
		const { signal } = listening;
		let target: HTMLAnchorElement | null = null;
		let timer = 0;
		const show = (next: HTMLAnchorElement, delay: number) => {
			if (next === target) return;
			target = next;
			clearTimeout(timer);
			timer = window.setTimeout(() => setRested(next), delay);
		};
		const hide = () => {
			target = null;
			clearTimeout(timer);
			setRested(null);
		};
		const within = (node: EventTarget | null) => target !== null && node instanceof Node && target.contains(node);
		document.addEventListener(
			"pointerover",
			event => {
				const next = event.pointerType === "touch" ? null : outsideLink(event.target);
				if (next) show(next, OPEN_DELAY_MS);
			},
			{ signal },
		);
		document.addEventListener("pointerout", event => within(event.target) && !within(event.relatedTarget) && hide(), { signal });
		document.addEventListener(
			"focusin",
			event => {
				const next = outsideLink(event.target);
				if (next?.matches(":focus-visible")) show(next, 0);
			},
			{ signal },
		);
		document.addEventListener("focusout", event => within(event.target) && hide(), { signal });
		document.addEventListener("pointerdown", hide, { signal, capture: true });
		document.addEventListener("keydown", event => event.key === "Escape" && hide(), { signal });
		document.addEventListener("scroll", event => target && event.target instanceof Node && event.target.contains(target) && hide(), { signal, capture: true });
		window.addEventListener("blur", hide, { signal });
		return () => {
			clearTimeout(timer);
			listening.abort();
		};
	}, []);
	return rested;
}

export function LinkPreviewCard() {
	const link = useRestedLink();
	if (!link) return null;
	return (
		<Popover open>
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
				<Body href={link.href} pages={link.closest('[data-link-preview="address"]') === null} />
			</PopoverContent>
		</Popover>
	);
}

/** The address, then, once read from an HTTPS page when `pages` allows, the site, title, and description above it. */
function Body({ href, pages }: { href: string; pages: boolean }) {
	const { hostname, host } = addressParts(href);
	const preview = usePreview(pages && href.startsWith("https:") ? href : null);
	const address = <SiteAddress url={href} className="line-clamp-3 break-all" />;
	if (!preview) {
		return (
			<p className="flex min-w-0 items-start gap-1.5 text-xs">
				<SiteIcon hostname={pages ? hostname : null} />
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
			<p className="mt-1.5 text-xs">{address}</p>
		</>
	);
}

/** What the server reads of `url`'s page, `null` until it answers or when it has nothing; no read for a `null` url. */
function usePreview(url: string | null): LinkPreview | null {
	const [preview, setPreview] = useState<LinkPreview | null>(null);
	useEffect(() => {
		if (!url) return;
		let live = true;
		getJson<LinkPreview | null>(`/api/link-preview?${new URLSearchParams({ url })}`).then(
			answer => live && setPreview(answer),
			() => undefined,
		);
		return () => {
			live = false;
		};
	}, [url]);
	return preview;
}
