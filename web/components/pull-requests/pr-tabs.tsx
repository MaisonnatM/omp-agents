/** The strip of open pull request tabs above a PR detail on the Pull requests page, which reorders, scrolls, and closes them. */
import { ChevronLeft, ChevronRight, Copy, Link, Plus, X } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { prKey, pullRequestName, pullRequestUrl, type PullRequest, type PullRequestSummary } from "../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { changePullRequestTabs, type PullRequestTab, type PullRequestTabsControl } from "../../pull-request-tabs";
import { listedPullRequest } from "../../pull-requests-model";
import { pullRequestsStore } from "../../reads";
import { useClipboard } from "../../use-copy";
import { STATE_ICON } from "./avatars";

/** The state the polled pull request list gives the tab's PR; a neutral glyph when the list leaves it out. */
function StateGlyph({ state }: { state: PullRequestSummary["state"] | null }) {
	const [Icon, color, label] = STATE_ICON[state ?? "open"];
	return <Icon aria-label={state ? label : "Pull request"} className={cn("size-3 group-hover/tab:hidden group-focus-within/tab:hidden [@media(hover:none)]:hidden", state ? color : "text-muted-foreground")} />;
}

interface TabLabelProps {
	pr: PullRequest;
	active: boolean;
	href: string;
	onMove: (by: -1 | 1) => void;
}

function TabLabel({ pr, active, href, onMove }: TabLabelProps) {
	return (
		<a
			href={href}
			aria-current={active ? "page" : undefined}
			draggable={false}
			data-tab-label
			title={pullRequestName(pr)}
			className="truncate rounded-sm select-none focus-visible:ring-2 focus-visible:ring-ring"
			onKeyDown={event => {
				if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
				event.preventDefault();
				event.stopPropagation();
				onMove(event.key === "ArrowLeft" ? -1 : 1);
			}}
		>
			#{pr.number}
		</a>
	);
}

interface Props extends PullRequestTabsControl {
	/** The workspace whose polled pull request list gives each tab its state. */
	workspace: string | null;
	/** Brings back the list to pick another PR from; without it the strip has no **+**. */
	onAdd?: () => void;
	/** Where each tab links. */
	hrefOf: (tab: PullRequestTab) => string;
}

export function PullRequestTabsStrip({ tabs, dispatch, workspace, onAdd, hrefOf }: Props) {
	const list = pullRequestsStore.use(workspace).read?.data ?? null;
	const viewport = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const drag = useRef<{ pr: PullRequest; start: number; moved: boolean } | null>(null);
	const suppressClick = useRef(false);
	const [drop, setDrop] = useState<{ pr: PullRequest; to: number } | null>(null);
	const shown = drop ? changePullRequestTabs(tabs, { type: "move", ...drop }) : tabs;
	const [edges, setEdges] = useState({ left: false, right: false });
	const clipboard = useClipboard();
	useEffect(() => {
		const node = viewport.current;
		const inner = content.current;
		if (!node || !inner) return;
		const update = () => setEdges({ left: node.scrollLeft > 1, right: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 });
		const wheel = (event: WheelEvent) => {
			if (event.ctrlKey) return;
			let delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (event.deltaMode === 1) delta *= 16;
			if (event.deltaMode === 2) delta *= node.clientWidth;
			const before = node.scrollLeft;
			node.scrollLeft += delta;
			if (node.scrollLeft !== before) event.preventDefault();
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		observer.observe(inner);
		node.addEventListener("scroll", update);
		node.addEventListener("wheel", wheel, { passive: false });
		update();
		return () => { observer.disconnect(); node.removeEventListener("scroll", update); node.removeEventListener("wheel", wheel); };
	}, []);
	useEffect(() => {
		const active = content.current?.querySelector<HTMLElement>("[aria-current]");
		active?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [tabs.active]);
	const movePointer = (event: PointerEvent<HTMLDivElement>) => {
		const current = drag.current;
		const node = viewport.current;
		if (!current || !node || !content.current) return;
		if (!current.moved && Math.abs(event.clientX - current.start) < 6) return;
		current.moved = true;
		suppressClick.current = true;
		const nodes = [...content.current.querySelectorAll<HTMLElement>("[data-pr-tab]")];
		const target = nodes.findIndex(tab => {
			const rect = tab.getBoundingClientRect();
			return event.clientX < rect.left + rect.width / 2;
		});
		const from = shown.open.findIndex(pr => prKey(pr) === prKey(current.pr));
		const gap = target < 0 ? nodes.length : target;
		const to = gap > from ? gap - 1 : gap;
		if (drop?.to !== to) setDrop({ pr: current.pr, to });
		const { left, right } = node.getBoundingClientRect();
		if (event.clientX > right - 24) node.scrollLeft += 16;
		if (event.clientX < left + 24) node.scrollLeft -= 16;
	};
	const endDrag = (commit: boolean) => {
		drag.current = null;
		if (commit && drop) dispatch({ type: "move", ...drop });
		setDrop(null);
	};
	return (
		<nav aria-label="Open pull requests" className="flex h-(--page-header-height) min-w-0 shrink-0 items-center gap-1 border-b border-border/60 pr-3 pl-2" data-pr-tabs>
			<div ref={viewport} className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				<div ref={content} className="flex w-max min-w-full items-center gap-1">
					{shown.open.map((pr, index) => (
						<ContextMenu key={prKey(pr)}>
							<ContextMenuTrigger render={<div />} data-pr-tab={prKey(pr)} className={cn("group/tab flex h-6 max-w-36 shrink-0 touch-pan-y items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs", tabs.active === prKey(pr) ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground", drop && prKey(drop.pr) === prKey(pr) && "opacity-50")}
								onPointerDown={event => {
									suppressClick.current = false;
									const target = event.target instanceof Element ? event.target : null;
									if (event.button !== 0 || !target || target.closest("[data-tab-close]")) return;
									drag.current = { pr, start: event.clientX, moved: false };
									target.closest("[data-tab-label]")?.setPointerCapture(event.pointerId);
								}}
								onPointerMove={movePointer}
								onPointerUp={() => endDrag(true)}
								onPointerCancel={() => endDrag(false)}
								onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
							>
								<button type="button" data-tab-close aria-label={`Close #${pr.number}`} title={`Close #${pr.number}`} onClick={() => dispatch({ type: "close", pr })} className="flex size-6 shrink-0 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
									<StateGlyph state={(list && listedPullRequest(list, pr)?.pr.state) ?? null} />
									<X aria-hidden className="hidden size-3 group-hover/tab:block group-focus-within/tab:block [@media(hover:none)]:block" />
								</button>
								<TabLabel pr={pr} active={tabs.active === prKey(pr)} href={hrefOf(pr)} onMove={by => dispatch({ type: "move", pr, to: index + by })} />
							</ContextMenuTrigger>
							<ContextMenuContent>
								<MenuItem onClick={() => clipboard.run(pullRequestUrl(pr))}><Link />Copy link</MenuItem>
								<MenuItem onClick={() => clipboard.run(`#${pr.number}`)}><Copy />Copy PR number</MenuItem>
								<MenuSeparator />
								<MenuItem onClick={() => dispatch({ type: "close", pr })}>Close</MenuItem>
								<MenuItem disabled={tabs.open.length < 2} onClick={() => dispatch({ type: "close-others", pr })}>Close others</MenuItem>
							</ContextMenuContent>
						</ContextMenu>
					))}
					{onAdd && <Tooltip content="Open another pull request"><Button size="icon-xs" variant="ghost-muted" aria-label="Open another pull request" onClick={onAdd}><Plus className="size-3.5" /></Button></Tooltip>}
				</div>
			</div>
			{(edges.left || edges.right) && <div className="flex shrink-0 gap-0.5">
				<Button size="icon-xs" variant="ghost" aria-label="Scroll tabs left" disabled={!edges.left} onClick={() => viewport.current?.scrollBy({ left: -160 })}><ChevronLeft /></Button>
				<Button size="icon-xs" variant="ghost" aria-label="Scroll tabs right" disabled={!edges.right} onClick={() => viewport.current?.scrollBy({ left: 160 })}><ChevronRight /></Button>
			</div>}
		</nav>
	);
}
