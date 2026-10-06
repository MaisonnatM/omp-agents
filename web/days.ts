/** Local days as todos, tickets, and the calendar name them: `YYYY-MM-DD`, which sorts as the days do. */

/** The day of `at` in the browser's time zone. */
export function localDay(at: number | Date = new Date()): string {
	const date = new Date(at);
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every day from `first` to `last`, both included; none when `last` comes first. */
export function daysBetween(first: string, last: string): string[] {
	const days: string[] = [];
	const [y, m, d] = first.split("-").map(Number);
	for (const date = new Date(y!, m! - 1, d!); ; date.setDate(date.getDate() + 1)) {
		const day = localDay(date);
		if (day > last) return days;
		days.push(day);
	}
}
