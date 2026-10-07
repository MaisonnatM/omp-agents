import { CircleAlert, ExternalLink, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { GoogleCalendarFeed, GoogleStatus } from "../../../src/shared/accounts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { errorText, putJson } from "../../api";
import { googleStore } from "../../reads";
import { MoreActionsMenu } from "../more-actions-menu";
import { GOOGLE_CALENDAR_LOGO } from "./brand-logos";
import { Callout, IntegrationRow, MetaDot } from "./integration-row";

const NAME = "Google Calendar";

const FIELD = "block h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One numbered step of finding a calendar's address. */
function Step({ n, children }: { n: number; children: ReactNode }) {
	return (
		<li className="flex gap-2.5">
			<span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-5 text-[11px] font-medium tabular-nums shadow-surface-2">
				{n}
			</span>
			<span className="pt-px text-pretty">{children}</span>
		</li>
	);
}

/** The steps to a calendar's secret address in Google Calendar's settings, then the address. */
function AddressForm({ id, onDone }: { id: string; onDone: () => void }) {
	const [url, setUrl] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		setSaving(true);
		setSaveError(null);
		try {
			await putJson<GoogleStatus>("/api/google/calendars", { url: url.trim() });
			await googleStore.refresh();
			onDone();
		} catch (err) {
			setSaveError(errorText(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<form id={id} aria-label="Calendar address" onSubmit={event => void save(event)} className="space-y-4 rounded-lg bg-muted/60 p-4 text-[13px]">
			<ol className="space-y-2.5">
				<Step n={1}>
					Open{" "}
					<a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline decoration-border underline-offset-2 hover:decoration-foreground">
						Google Calendar's settings
						<ExternalLink aria-hidden className="size-3" />
					</a>
					.
				</Step>
				<Step n={2}>Under Settings for my calendars, choose a calendar, then Integrate calendar.</Step>
				<Step n={3}>Copy its Secret address in iCal format and paste it here. Anyone with it can read the calendar, so it stays on this machine.</Step>
			</ol>
			<label className="block space-y-1">
				<span className="text-xs font-medium">Secret address in iCal format</span>
				<input
					name="google-calendar-address"
					type="url"
					autoComplete="off"
					spellCheck={false}
					autoFocus
					value={url}
					onChange={event => setUrl(event.target.value)}
					required
					placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
					className={FIELD}
				/>
			</label>
			{saveError && (
				<Callout tone="danger" icon={CircleAlert} role="alert">
					Cannot add the calendar: {saveError}
				</Callout>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="compact" disabled={saving} onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" size="compact" loading={saving}>
					Add calendar
				</Button>
			</div>
		</form>
	);
}

/** An added calendar: its color and name, why its last read failed, and its removal. */
function CalendarItem({ calendar }: { calendar: GoogleCalendarFeed }) {
	const [removeError, setRemoveError] = useState<string | null>(null);
	const remove = async (): Promise<void> => {
		setRemoveError(null);
		try {
			await putJson<GoogleStatus>("/api/google/calendars/remove", { id: calendar.id });
			await googleStore.refresh();
		} catch (err) {
			setRemoveError(errorText(err));
		}
	};
	const error = removeError ? `Cannot remove it: ${removeError}` : calendar.error;
	return (
		<li className="flex items-start gap-2.5 py-1.5 text-[13px]">
			<span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} />
			<div className="min-w-0 flex-1">
				<p className="truncate" title={calendar.name}>
					{calendar.name}
				</p>
				{error && <p className="text-xs text-pretty text-red-600 dark:text-red-400">{error}</p>}
			</div>
			<MoreActionsMenu name={calendar.name}>
				<MenuItem variant="destructive" onClick={() => void remove()}>
					<Trash2 />
					Remove
				</MenuItem>
			</MoreActionsMenu>
		</li>
	);
}

interface GoogleCalendarRowProps {
	/** The last read of `/api/google`, `null` until one succeeds. */
	status: GoogleStatus | null;
	error: string | null;
}

/** Google Calendar: the calendars this dashboard reads from their addresses in iCal format, owned by it rather than by omp. */
export function GoogleCalendarRow({ status, error }: GoogleCalendarRowProps) {
	const [formOpen, setFormOpen] = useState(false);
	const formId = useId();
	const calendars = status?.calendars ?? [];

	let badge: ReactNode = null;
	if (calendars.some(calendar => calendar.error)) badge = <Badge variant="dot" size="compact" color="amber">Cannot read a calendar</Badge>;
	else if (calendars.length > 0) badge = <Badge variant="dot" size="compact" color="green">Connected</Badge>;
	else if (status) badge = <Badge variant="dot" size="compact" color="gray">Not set up</Badge>;

	const actions = formOpen ? null : (
		<Button variant="secondary" size="compact" disabled={!status} onClick={() => setFormOpen(true)}>
			Add calendar
		</Button>
	);

	return (
		<IntegrationRow
			name={NAME}
			logo={GOOGLE_CALENDAR_LOGO}
			summary="Events from the calendars you add, on the Calendar tab. Read-only."
			status={badge}
			meta={
				<>
					<span>iCal</span>
					<MetaDot />
					<span>This dashboard only</span>
				</>
			}
			actions={actions}
		>
			{!status && error && (
				<Callout tone="danger" icon={CircleAlert}>
					Cannot check Google Calendar: {error}
				</Callout>
			)}
			{calendars.length > 0 && (
				<ul aria-label="Calendars" className="divide-y divide-border">
					{calendars.map(calendar => (
						<CalendarItem key={calendar.id} calendar={calendar} />
					))}
				</ul>
			)}
			{formOpen && <AddressForm id={formId} onDone={() => setFormOpen(false)} />}
		</IntegrationRow>
	);
}
