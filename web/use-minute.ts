import { useEffect, useState } from "react";

/** The time now, renewed each minute, so "Today" turns into "Tomorrow" and a passed slot reads as due. */
export function useMinute(): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}
