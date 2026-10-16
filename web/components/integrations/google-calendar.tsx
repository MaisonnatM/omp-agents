import { CircleAlert } from "lucide-react";
import type { AccountId } from "../../../src/shared/accounts";
import type { GoogleStatus } from "../../../src/shared/calendar";
import { cn } from "@/lib/utils";
import type { PolledEntry } from "../../polled-store";
import { Callout } from "./integration-row";

/**
 * The calendars checked in account `account`'s Google Calendar list, each with why its last read failed, one unchecked
 * in the Calendar page's sidebar muted; why the list could not be read when it could not.
 */
export function GoogleCalendarList({ entry, account }: { entry: PolledEntry<GoogleStatus>; account: AccountId }) {
	const status = entry.read?.data;
	const failed = status?.failed.find(listed => listed.account === account)?.error ?? (status ? null : entry.error);
	if (failed) {
		return (
			<Callout tone="danger" icon={CircleAlert}>
				Cannot list your calendars: {failed}
			</Callout>
		);
	}
	if (!status) return null;
	const calendars = status.calendars.filter(calendar => calendar.account === account);
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
