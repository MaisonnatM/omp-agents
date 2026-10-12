import { age } from "../labels";
import { useMinute } from "../use-minute";

interface AgeProps {
	at: number;
	/** Only the largest unit, as {@link age} words it with `compact`, for a narrow column. */
	compact?: boolean;
	/** The exact time on hover; left off inside a row whose own tooltip already shows. */
	exact?: boolean;
	className: string;
}

/** How long ago `at` was, counting up each minute on its own, so a row's age stays current between socket updates. */
export function Age({ at, compact = false, exact = false, className }: AgeProps) {
	useMinute();
	return (
		<span className={className} title={exact ? new Date(at).toLocaleString() : undefined}>
			{age(at, { compact })}
		</span>
	);
}
