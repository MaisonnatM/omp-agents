import { memo, useCallback, useRef } from "react";
import type { PastSession, RosterHost } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import { type ModelList, UNREAD } from "../reads";
import type { SplitAxis, SplitRatios } from "../pane-navigation";
import { hashForView, type Layout } from "../routing";
import { Pane } from "./pane";
import { SplitResizeHandle, splitAt } from "./split-resize-handle";

interface PaneGridProps {
	layout: Layout;
	hosts: RosterHost[];
	past: PastSession[];
	lastHosts: ReadonlyMap<string, RosterHost>;
	models: ReadonlyMap<string, ModelList>;
	/** The workspaces, which each composer's directory picker offers. */
	workspaces: Workspace[];
	/** A pane fills the grid. */
	maximized: boolean;
	/** The right sidebar shows the focused session's details, so the top right pane carries its toggle. */
	hasDetails: boolean;
	rightOpen: boolean;
	show: (layout: Layout) => void;
	close: (index: number) => void;
	ratios: SplitRatios;
	resize: (axis: SplitAxis, ratio: number) => void;
	toggleSidebar: (side: "right") => void;
}

/**
 * The panes in their grid, up to four, with the handles that resize it. It takes only what the panes read, and every
 * pane's props stay equal while a token streams, so the grid renders for roster, layout, and divider changes alone.
 */
export const PaneGrid = memo(function PaneGrid({ layout, hosts, past, lastHosts, models, workspaces, maximized, hasDetails, rightOpen, show, close, ratios: { columns, rows }, resize, toggleSidebar }: PaneGridProps) {
	const setColumns = useCallback((ratio: number) => resize("columns", ratio), [resize]);
	const setRows = useCallback((ratio: number) => resize("rows", ratio), [resize]);
	const latest = useRef(layout);
	latest.current = layout;
	const onLayout = useCallback(
		(index: number, kind: "max" | "close") => {
			const current = latest.current;
			if (kind === "close") close(index);
			else show({ ...current, focus: index, maximized: !current.maximized });
		},
		[show, close],
	);
	const toggleRight = useCallback(() => toggleSidebar("right"), [toggleSidebar]);
	const split = layout.panes.length > 1;
	const topRightPane = maximized ? layout.focus : Math.min(1, layout.panes.length - 1);
	return (
		<div
			className="relative grid h-full min-h-0 gap-px bg-border"
			style={{
				gridTemplateColumns: split ? `${splitAt(columns)} minmax(0, 1fr)` : "minmax(0, 1fr)",
				gridTemplateRows: layout.panes.length > 2 ? `${splitAt(rows)} minmax(0, 1fr)` : "minmax(0, 1fr)",
			}}
		>
			{layout.panes.map((pane, index) => (
				// Keyed by view: moving to another cell keeps a pane's draft and scroll; another view resets them.
				// A maximized pane covers the whole grid; the rest stay mounted, at their size, under it.
				<Pane
					key={hashForView(pane)}
					view={pane}
					index={index}
					count={layout.panes.length}
					focused={index === layout.focus}
					maximized={maximized}
					topRight={index === topRightPane}
					hasDetails={hasDetails}
					host={pane.kind === "live" ? hosts.find(h => h.instanceId === pane.instanceId) ?? null : null}
					lastHost={pane.kind === "live" ? lastHosts.get(pane.instanceId) ?? null : null}
					session={pane.kind === "past" ? past.find(s => s.sessionId === pane.sessionId) ?? null : null}
					models={(pane.kind === "live" && models.get(pane.instanceId)) || UNREAD}
					workspaces={workspaces}
					onLayout={onLayout}
					toggleRight={toggleRight}
					rightOpen={rightOpen}
				/>
			))}
			{split && !maximized && <SplitResizeHandle axis="columns" ratio={columns} onRatio={setColumns} span={layout.panes.length === 3 ? rows : 1} />}
			{layout.panes.length > 2 && !maximized && <SplitResizeHandle axis="rows" ratio={rows} onRatio={setRows} />}
		</div>
	);
});
