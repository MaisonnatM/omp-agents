import { SHIP_STAGES, type ShipProgress } from "../../src/shared/sessions";
import { Tooltip } from "@/components/ui/tooltip";

const SHIP_NAMES: Record<ShipProgress["stage"] | NonNullable<ShipProgress["work"]>, string> = {
	ticket: "Ticket", implement: "Implement", draft_pr: "Draft PR", thermonuclear: "Thermonuclear",
	ready_gate: "Ready gate", live: "Live for review", merged: "Merged",
	rebase: "Rebase", fix_comments: "Fix comments", fix_ci: "Fix CI",
};

/** A session's /ship stage, as `3/7 · Draft PR`. */
export function ShipStep({ ship }: { ship: ShipProgress | null }) {
	if (!ship) return null;
	const text = `${SHIP_STAGES.indexOf(ship.stage) + 1}/7 · ${SHIP_NAMES[ship.work ?? ship.stage]}`;
	return (
		<Tooltip content={`${ship.issue ?? "Ship"} · ${text}`}>
			<span className="inline-block max-w-36 shrink-0 truncate rounded bg-muted px-1.5 text-xs text-muted-foreground">{text}</span>
		</Tooltip>
	);
}
