/** The up or down arrow that moves an entry of a list one place. */
import { IconArrowDown, IconArrowUp } from "central-icons";
import type { ControlId } from "../../src/shared/activity";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";

/**
 * Moves `label` one place up or down; `control` names it in the activity log. At the list's edge it stays focusable and
 * does nothing, so pressing it until the entry reaches the edge keeps keyboard focus on it, and its tooltip says why.
 */
export function OrderButton({ label, direction, disabled, onClick, control }: { label: string; direction: "up" | "down"; disabled: boolean; onClick: () => void; control?: ControlId }) {
	return (
		<Tooltip content={disabled ? `${label} is already ${direction === "up" ? "first" : "last"}` : `Move ${label} ${direction}`}>
			<Button
				{...(control && activityControl(control))}
				variant="ghost"
				size="icon-compact"
				className="aria-disabled:cursor-default aria-disabled:opacity-50"
				aria-label={`Move ${label} ${direction}`}
				aria-disabled={disabled || undefined}
				onClick={disabled ? undefined : onClick}
			>
				{direction === "up" ? <IconArrowUp /> : <IconArrowDown />}
			</Button>
		</Tooltip>
	);
}
