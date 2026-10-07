import type { TicketChoice } from "../../../src/shared/tickets";

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
		<label className="flex items-center gap-2 text-xs text-muted-foreground">
			Team
			<select
				value={value}
				disabled={disabled}
				onChange={event => onChange(event.target.value)}
				className="h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
			>
				{teams.map(({ id, name }) => (
					<option key={id} value={id}>
						{name}
					</option>
				))}
			</select>
		</label>
	);
}
