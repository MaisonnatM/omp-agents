/** Local days as todos, tickets, the calendar, and Settings › Activity name them: `YYYY-MM-DD`, which sorts as the days do; and the `HH:MM` of a time input. */

/** A day's milliseconds, ignoring daylight saving's long and short days. */
export const DAY_MS = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, "0");

/** The day of `at` in the local time zone: the browser's on the page, the server's on the server. */
export function localDay(at: number | Date = new Date()): string {
	const date = new Date(at);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `minutes` after midnight as an `<input type="time">` value, `HH:MM`. */
export const timeInputValue = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** The minutes after midnight of an `<input type="time">` value, `HH:MM`, or `null` for a cleared one. */
export function minutesOfTimeInput(value: string): number | null {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The local midnight that starts `day`, `YYYY-MM-DD`. */
export function dateOfDay(day: string): Date {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y!, m! - 1, d!);
}

/** Every day from `first` to `last`, both included; none when `last` comes first. */
export function daysBetween(first: string, last: string): string[] {
	const days: string[] = [];
	for (const date = dateOfDay(first); ; date.setDate(date.getDate() + 1)) {
		const day = localDay(date);
		if (day > last) return days;
		days.push(day);
	}
}
