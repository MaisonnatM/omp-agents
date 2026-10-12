/** `GoogleCalendarList`: the Google calendars the integration reads, each with why its last read failed. */
import { CircleAlert } from "lucide-react";
import type { GoogleStatus } from "../../../src/shared/calendar";
import { cn } from "@/lib/utils";
import type { PolledEntry } from "../../polled-store";
import { Callout } from "./integration-row";

/** The calendars checked in Google Calendar's list, each with why its last read failed, one unchecked in the Calendar page's sidebar muted. */
export function GoogleCalendarList({ entry }: { entry: PolledEntry<GoogleStatus> }) {
	const calendars = entry.read?.data.calendars;
	if (!calendars) {
		return entry.error ? (
			<Callout tone="danger" icon={CircleAlert}>
				Cannot list your calendars: {entry.error}
			</Callout>
		) : null;
	}
	if (calendars.length === 0) {
		return <p className="text-[13px] text-muted-foreground">No calendar is checked in Google Calendar's list. Check one there to see its events on the Calendar page.</p>;
	}
	return (
		<ul aria-label="Calendars on the Calendar page" className="divide-y divide-border">
			{calendars.map(calendar => (
				<li key={calendar.id} className={cn("flex items-start gap-2.5 py-1.5 text-[13px]", !calendar.shown && "text-muted-foreground")}>
					<span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", !calendar.shown && "opacity-50")} style={{ backgroundColor: calendar.color }} />
					<div className="min-w-0 flex-1">
						<p className="truncate" title={calendar.name}>
							{calendar.name}
						</p>
						{!calendar.shown && <p className="text-xs">Hidden on the Calendar page</p>}
						{calendar.error && <p className="text-xs text-pretty text-red-600 dark:text-red-400">{calendar.error}</p>}
					</div>
				</li>
			))}
		</ul>
	);
}
