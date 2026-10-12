import type { TicketChoice } from "../../../src/shared/tickets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The Linear team the last new issue went in. */
const LAST_TEAM_KEY = "omp-agents.ticket-team";

/** The team a new issue goes in first: the last one used while Linear still lists it, else Linear's first. `teams` is never empty. */
export function preferredTeam(teams: TicketChoice[]): string {
	const last = localStorage.getItem(LAST_TEAM_KEY);
	return (teams.find(({ id }) => id === last) ?? teams[0]!).id;
}

/** Keeps `team`, the one an issue just opened in, for {@link preferredTeam}. */
export const rememberTeam = (team: string): void => localStorage.setItem(LAST_TEAM_KEY, team);

interface TeamSelectProps {
	teams: TicketChoice[];
	value: string;
	disabled: boolean;
	onChange: (team: string) => void;
}

/** The Linear team a new issue goes in. */
export function TeamSelect({ teams, value, disabled, onChange }: TeamSelectProps) {
	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			Team
			<Select items={teams.map(({ id, name }) => ({ value: id, label: name }))} value={value} disabled={disabled} onValueChange={next => next && onChange(next)}>
				<SelectTrigger aria-label="Team" className="text-foreground">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{teams.map(({ id, name }) => (
						<SelectItem key={id} value={id}>
							{name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
