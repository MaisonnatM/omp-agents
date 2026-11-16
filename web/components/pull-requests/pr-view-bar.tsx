/**
 * The bar above the Pull requests page's list: a tab per preset of the sections it shows, **Filter**, which picks them
 * one by one, the page's own menus, and under them the chip that names the sections while it shows fewer than all.
 */
import { IconCrossMedium, IconFilter1, IconLayersTwo } from "central-icons";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuSwitchItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { EVERY_SECTION, PULL_REQUEST_VIEWS, type PullRequestOrder, type PullRequestView, sectionTitles, type ShownSections, viewOf, withSectionToggled } from "../../pull-requests-model";
import { activityControl } from "../../activity";
import { useShownSections } from "../../pull-requests-state";

const VIEWS = Object.keys(PULL_REQUEST_VIEWS) as PullRequestView[];

interface SectionsMenuProps {
	order: PullRequestOrder;
	shown: ShownSections;
	onShown: (shown: ShownSections) => void;
	/** The button that opens the menu. */
	trigger: ReactElement;
	/** The side of the trigger the menu lines up with. */
	align: "start" | "end";
	children: ReactNode;
}

/** A switch per section, in page order; the last one shown stays on, since the list always shows a section. */
function SectionsMenu({ order, shown, onShown, trigger, align, children }: SectionsMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={trigger}>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align={align} className="w-56">
				{sectionTitles(order).map(title => (
					<MenuSwitchItem
						{...activityControl("pull-requests.filter.section")}
						key={title}
						checked={shown.has(title)}
						disabled={shown.size === 1 && shown.has(title)}
						closeOnClick={false}
						onCheckedChange={() => onShown(withSectionToggled(shown, title))}
					>
						{title}
					</MenuSwitchItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** `Section · is either of · N sections · ×`: what the list shows, whose value reopens the switches and whose × shows every section. */
function SectionsChip({ order, shown, onShown }: { order: PullRequestOrder; shown: ShownSections; onShown: (shown: ShownSections) => void }) {
	const titles = sectionTitles(order).filter(title => shown.has(title));
	const value = titles.length === 1 ? titles[0] : `${titles.length} sections`;
	const cell = "flex items-center px-2";
	const pressable = "outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-inset";
	return (
		<div role="group" aria-label="Filter" className="inline-flex h-7 items-stretch divide-x divide-border overflow-hidden rounded-md border border-border bg-popover text-xs">
			<span className={`${cell} gap-1.5 font-medium`}>
				<IconLayersTwo aria-hidden className="size-3.5 text-muted-foreground" />
				Section
			</span>
			<span className={`${cell} text-muted-foreground`}>{titles.length === 1 ? "is" : "is either of"}</span>
			<SectionsMenu order={order} shown={shown} onShown={onShown} align="start" trigger={<button type="button" title={titles.join(", ")} className={`${cell} font-medium ${pressable}`} />}>
				{value}
			</SectionsMenu>
			<Tooltip content="Show every section">
				<button {...activityControl("pull-requests.filter.clear")} type="button" aria-label="Remove the filter" className={`${cell} text-muted-foreground hover:text-foreground ${pressable}`} onClick={() => onShown(EVERY_SECTION)}>
					<IconCrossMedium aria-hidden className="size-3" />
				</button>
			</Tooltip>
		</div>
	);
}

/** The tabs, **Filter** and `menus` at the end of their row, and the chip under them while the list leaves a section out. */
export function PullRequestViewBar({ order, menus }: { order: PullRequestOrder; menus: ReactNode }) {
	const [shown, setShown] = useShownSections();
	const view = viewOf(shown);
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<div role="group" aria-label="View" className="flex min-w-0 flex-wrap gap-1.5">
					{VIEWS.map(each => (
						<Button {...activityControl("pull-requests.view")} key={each} variant="tertiary" size="compact" active={each === view} aria-pressed={each === view} onClick={() => setShown(PULL_REQUEST_VIEWS[each].sections)}>
							{PULL_REQUEST_VIEWS[each].label}
						</Button>
					))}
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<SectionsMenu order={order} shown={shown} onShown={setShown} align="end" trigger={<Button {...activityControl("pull-requests.filter")} variant="outline" size="icon-compact" aria-label="Filter the sections" />}>
						<IconFilter1 />
					</SectionsMenu>
					{menus}
				</div>
			</div>
			{shown.size < EVERY_SECTION.size && <SectionsChip order={order} shown={shown} onShown={setShown} />}
		</div>
	);
}
