import { useStoredState } from "./stored-state";

const ROUTINES_KEY = "omp-agents.calendar-routines";
const decodeShown = (raw: string | null): boolean => raw !== "off";

export function useCalendarRoutines(): [boolean, (shown: boolean) => void] {
	return useStoredState(ROUTINES_KEY, decodeShown, shown => (shown ? "on" : "off"));
}
