/** The card over a link to another site, shown while the pointer rests on it or keyboard focus reaches it: the site, the page's title and description, and the address. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LinkPreview } from "../../src/shared/link-preview";
import { getJson } from "../api";
import { cn } from "@/lib/utils";
import { labelOf, SiteIcon } from "./sources-section";

const OPEN_DELAY_MS = 400;
const GAP = 6;
const MARGIN = 8;

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

export function LinkPreviewCard() {
	const [link, setLink] = useState<HTMLAnchorElement | null>(null);
	useEffect(() => {
		let target: HTMLAnchorElement | null = null;
		let timer = 0;
		const show = (next: HTMLAnchorElement, delay: number) => {
			if (next === target) return;
			target = next;
			clearTimeout(timer);
			timer = window.setTimeout(() => setLink(next), delay);
		};
		const hide = () => {
			target = null;
			clearTimeout(timer);
			setLink(null);
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
	return link ? createPortal(<Card key={link.href} link={link} />, document.body) : null;
}

/** Below the link, or above it when the card would run past the window's bottom, kept inside the window's sides. */
function Card({ link }: { link: HTMLAnchorElement }) {
	const href = link.href;
	const { hostname, host, rest } = labelOf(href);
	const [preview, setPreview] = useState<LinkPreview | null>(null);
	const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
	const card = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let live = true;
		void previewOf(href).then(answer => live && setPreview(answer));
		return () => {
			live = false;
		};
	}, [href]);
	useLayoutEffect(() => {
		const anchor = link.getBoundingClientRect();
		const { width, height } = card.current!.getBoundingClientRect();
		const below = anchor.bottom + GAP + height <= window.innerHeight - MARGIN;
		setPlace({
			top: below ? anchor.bottom + GAP : Math.max(MARGIN, anchor.top - GAP - height),
			left: Math.min(Math.max(MARGIN, anchor.left), window.innerWidth - width - MARGIN),
		});
	}, [link, preview]);
	return (
		<div
			ref={card}
			aria-hidden="true"
			style={place ?? { top: 0, left: 0, visibility: "hidden" }}
			className={cn("pointer-events-none fixed z-[100] w-80 rounded-md border bg-popover p-3 text-popover-foreground shadow-md", place && "animate-in fade-in-0 zoom-in-95")}
		>
			{preview ? (
				<>
					<p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
						<SiteIcon hostname={hostname} />
						<span className="truncate">{preview.site ?? host}</span>
					</p>
					<p className="mt-1.5 line-clamp-2 text-sm font-medium">{preview.title}</p>
					{preview.description && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{preview.description}</p>}
					<p className="mt-1.5 truncate text-xs text-muted-foreground">
						{host}
						{rest}
					</p>
				</>
			) : (
				<p className="flex min-w-0 items-center gap-1.5 text-xs">
					<SiteIcon hostname={hostname} />
					<span className="min-w-0 truncate">
						<span className="text-foreground">{host}</span>
						{rest && <span className="text-muted-foreground">{rest}</span>}
					</span>
				</p>
			)}
		</div>
	);
}
