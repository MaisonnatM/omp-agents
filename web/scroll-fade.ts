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
	const watchScroller = (scroller: HTMLElement): void => {
		watch(scroller, scroller);
		for (const child of scroller.children) watch(child, scroller);
	};
	/** Watches every scroller in `node`, which a mutation added. */
	const scan = (node: Node): void => {
		if (!(node instanceof HTMLElement)) return;
		if (node.matches(".scroll-fade")) watchScroller(node);
		for (const scroller of node.querySelectorAll<HTMLElement>(".scroll-fade")) watchScroller(scroller);
	};
	// An unmounted transcript must not stay observed; one sweep per frame serves every removal in it.
	let sweeping = false;
	const sweep = (): void => {
		sweeping = false;
		for (const element of watched.keys()) {
			if (element.isConnected) continue;
			resizes.unobserve(element);
			watched.delete(element);
		}
	};
	// Content grows by resizing a child or adding one, so a node added to a scroller is watched too.
	new MutationObserver(records => {
		for (const { target, addedNodes, removedNodes } of records) {
			if (watched.get(target as Element) === target) {
				for (const node of addedNodes) if (node instanceof Element) watch(node, target as HTMLElement);
			}
			for (const node of addedNodes) scan(node);
			if (removedNodes.length > 0 && !sweeping) {
				sweeping = true;
				requestAnimationFrame(sweep);
			}
		}
	}).observe(document.body, { childList: true, subtree: true });
	scan(document.body);
	document.addEventListener(
		"scroll",
		event => {
			const scroller = event.target instanceof HTMLElement ? watched.get(event.target) : undefined;
			if (scroller === event.target) update(scroller);
		},
		{ capture: true, passive: true },
	);
}
