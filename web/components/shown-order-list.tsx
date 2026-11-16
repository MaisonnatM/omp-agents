/** A list whose entries each show or hide with a switch and move up or down with arrows. */
import type { ReactNode } from "react";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { ControlId } from "../../src/shared/activity";
import { activityControl } from "../activity";
import { OrderButton } from "./order-button";
import { ToggleSwitch } from "./toggle-switch";

/** One entry of a `ShownOrderList`, under its stable `key`. */
export interface ShownOrderRow<K extends string> {
	key: K;
	label: string;
	shown: boolean;
	icon?: IconComponent;
	note?: ReactNode;
}

/** `rows` in their order; `controls` names the switch and the arrows in the activity log. */
export function ShownOrderList<K extends string>({
	rows,
	onShow,
	onMove,
	controls,
}: {
	rows: readonly ShownOrderRow<K>[];
	onShow: (key: K, shown: boolean) => void;
	onMove: (key: K, by: -1 | 1) => void;
	controls?: { show: ControlId; move: ControlId };
}) {
	return (
		<ol className="space-y-1 text-sm">
			{rows.map(({ key, label, shown, icon: Icon, note }, index) => (
				<li key={key} className="flex items-center gap-2">
					{Icon && <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
					<div className="min-w-0 flex-1">
						<p title={label} className={cn("truncate", !shown && "text-muted-foreground")}>
							{label}
						</p>
						{note && <p className="text-xs text-muted-foreground">{note}</p>}
					</div>
					<ToggleSwitch {...(controls && activityControl(controls.show))} checked={shown} onCheckedChange={checked => onShow(key, checked)} aria-label={`Show ${label}`} />
					<OrderButton label={label} direction="up" disabled={index === 0} onClick={() => onMove(key, -1)} control={controls?.move} />
					<OrderButton label={label} direction="down" disabled={index === rows.length - 1} onClick={() => onMove(key, 1)} control={controls?.move} />
				</li>
			))}
		</ol>
	);
}
