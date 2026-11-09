/** `SpacePicker`: the select that places something in a space, a workspace in Settings › Workspaces and a Google account in Settings › Integrations. */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Space, SPACES } from "../../src/shared/workspaces";
import { SPACE_LABELS } from "../labels";

const SPACE_ITEMS = SPACES.map(value => ({ value, label: SPACE_LABELS[value] }));

/** The space of what `label` names, Work or Personal; a pick of the other one calls `onPick`. */
export function SpacePicker({ label, space, disabled, onPick }: { label: string; space: Space; disabled: boolean; onPick: (space: Space) => void }) {
	return (
		<Select<Space> items={SPACE_ITEMS} value={space} disabled={disabled} onValueChange={next => next && next !== space && onPick(next)}>
			<SelectTrigger aria-label={label} className="w-fit">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{SPACE_ITEMS.map(({ value, label }) => (
					<SelectItem key={value} value={value}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
