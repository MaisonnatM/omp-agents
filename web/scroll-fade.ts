/**
 * Sets `--sf-start` and `--sf-end` on every `.scroll-fade` scroller from its scroll position, for browsers without scroll-driven animations (Firefox), where globals.css cannot.
 * An edge fades only while content lies past it, so a scroller with nothing to scroll shows no fade.
 */
export function startScrollFade(): void {
	if (CSS.supports("animation-timeline: scroll()")) return;
	/** Each watched element, the scroller or one of its children, and the scroller whose fade its size changes. */
	const watched = new Map<Element, HTMLElement>();
	const update = (scroller: HTMLElement): void => {
		const size = parseFloat(getComputedStyle(scroller).getPropertyValue("--scroll-fade-size"));
		const opacity = (past: number): string => String(Math.min(1, Math.max(0, 1 - past / size)));
		scroller.style.setProperty("--sf-start", opacity(scroller.scrollTop));
		scroller.style.setProperty("--sf-end", opacity(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop));
	};
	const resizes = new ResizeObserver(entries => {
		for (const { target } of entries) {
			const scroller = watched.get(target);
			if (scroller) update(scroller);
		}
	});
	const watch = (element: Element, scroller: HTMLElement): void => {
		if (watched.has(element)) return;
		watched.set(element, scroller);
		resizes.observe(element);
	};
	// Content grows by resizing a child or adding one, and an unmounted transcript must not stay observed.
	const sync = (): void => {
		for (const element of watched.keys()) {
			if (element.isConnected) continue;
			resizes.unobserve(element);
			watched.delete(element);
		}
		for (const scroller of document.querySelectorAll<HTMLElement>(".scroll-fade")) {
			watch(scroller, scroller);
			for (const child of scroller.children) watch(child, scroller);
		}
	};
	new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
	sync();
	document.addEventListener(
		"scroll",
		event => {
			const scroller = event.target instanceof HTMLElement ? watched.get(event.target) : undefined;
			if (scroller === event.target) update(scroller);
		},
		{ capture: true, passive: true },
	);
}
