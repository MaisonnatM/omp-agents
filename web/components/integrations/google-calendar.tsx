import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID, type GoogleClientInput, type GoogleSetup, type GoogleStatus, googleRedirectUri, type McpIntegration } from "../../../src/shared/accounts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import type { PolledEntry } from "../../polled-store";
import { integrationsStore } from "../../reads";
import { describedBy, External, Field, FIELD, Step } from "./client-form";
import { Callout } from "./integration-row";

const FIELD_ORDER = ["clientId", "clientSecret", "callbackPort"] as const;
type FieldErrors = Partial<Record<(typeof FIELD_ORDER)[number], string>>;

/** The port typed in, or `null` when it is not one. */
function portOf(text: string): number | null {
	const port = /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
	return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

interface GoogleClientFormProps {
	setup: GoogleSetup;
	connected: boolean;
	onDone: () => void;
}

/** The steps to a Google OAuth client for omp, then its ID, secret, and the port omp listens on for Google's redirect. */
export function GoogleClientForm({ setup, connected, onDone }: GoogleClientFormProps) {
	const baseId = useId();
	const ids = { clientId: `${baseId}-client-id`, clientSecret: `${baseId}-client-secret`, callbackPort: `${baseId}-port` };
	const refs = { clientId: useRef<HTMLInputElement>(null), clientSecret: useRef<HTMLInputElement>(null), callbackPort: useRef<HTMLInputElement>(null) };
	const [clientId, setClientId] = useState(setup.clientId ?? "");
	const [clientSecret, setClientSecret] = useState("");
	const [callbackPort, setCallbackPort] = useState(String(setup.callbackPort));
	const [errors, setErrors] = useState<FieldErrors>({});
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const replacing = setup.configured || setup.hasClientSecret || setup.clientId !== null;
	const port = portOf(callbackPort);
	const keepsSecret = !clientSecret.trim() && setup.hasClientSecret && clientId.trim() === setup.clientId;

	const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (saving) return;
		const next: FieldErrors = {};
		if (!GOOGLE_CLIENT_ID.test(clientId.trim())) next.clientId = "Enter the OAuth client's ID, which ends in .apps.googleusercontent.com.";
		if (!clientSecret.trim() && !keepsSecret) next.clientSecret = setup.hasClientSecret ? "Enter the new client's secret. A blank secret only keeps the saved one for the same client ID." : "Enter the OAuth client's secret.";
		if (port === null) next.callbackPort = "Enter a callback port from 1 to 65535.";
		setErrors(next);
		setSaveError(null);
		const first = FIELD_ORDER.find(field => next[field]);
		if (first || port === null) {
			if (first) refs[first].current?.focus();
			return;
		}
		const secret = clientSecret.trim();
		const body: GoogleClientInput = { clientId: clientId.trim(), callbackPort: port };
		if (secret) body.clientSecret = secret;
		setSaving(true);
		try {
			await putJson<McpIntegration>("/api/integrations/google-calendar/client", body);
			await integrationsStore.refresh();
			onDone();
		} catch (err) {
			const message = errorText(err);
			setSaveError(secret ? message.replaceAll(secret, "the client secret") : message);
		} finally {
			setSaving(false);
		}
	};

	const clearError = (field: keyof FieldErrors) => setErrors(current => (current[field] ? { ...current, [field]: undefined } : current));

	return (
		<form aria-label="Google OAuth client" noValidate onSubmit={event => void save(event)} className="space-y-4 rounded-lg bg-muted/60 p-4 text-[13px]">
			<ol className="space-y-2.5">
				<Step n={1}>
					In a <External href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Google Cloud project</External>, turn on the Google Calendar API.
				</Step>
				<Step n={2}>
					Create an OAuth client ID of type Web application under <External href="https://console.cloud.google.com/apis/credentials">Credentials</External>. Add{" "}
					<code className="font-mono text-xs">{googleRedirectUri(port ?? setup.callbackPort)}</code> as an authorized redirect URI.
				</Step>
				<Step n={3}>Paste the client's ID and secret. This page does not show the secret again.</Step>
			</ol>
			<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
				<Field id={ids.clientId} label="Client ID" error={errors.clientId}>
					<input
						ref={refs.clientId}
						id={ids.clientId}
						name="google-client-id"
						type="text"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						autoFocus
						value={clientId}
						onChange={event => {
							setClientId(event.target.value);
							clearError("clientId");
						}}
						aria-invalid={errors.clientId ? true : undefined}
						aria-describedby={describedBy(ids.clientId, false, Boolean(errors.clientId))}
						placeholder="…apps.googleusercontent.com"
						className={FIELD}
					/>
				</Field>
				<Field id={ids.clientSecret} label="Client secret" hint={setup.hasClientSecret ? "A secret is saved for this client ID. Leave this blank to keep it." : undefined} error={errors.clientSecret}>
					<input
						ref={refs.clientSecret}
						id={ids.clientSecret}
						name="google-client-secret"
						type="password"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						value={clientSecret}
						onChange={event => {
							setClientSecret(event.target.value);
							clearError("clientSecret");
						}}
						aria-invalid={errors.clientSecret ? true : undefined}
						aria-describedby={describedBy(ids.clientSecret, setup.hasClientSecret, Boolean(errors.clientSecret))}
						className={FIELD}
					/>
				</Field>
				<Field id={ids.callbackPort} label="Callback port" error={errors.callbackPort}>
					<input
						ref={refs.callbackPort}
						id={ids.callbackPort}
						name="google-callback-port"
						type="text"
						inputMode="numeric"
						autoComplete="off"
						spellCheck={false}
						value={callbackPort}
						onChange={event => {
							setCallbackPort(event.target.value);
							clearError("callbackPort");
						}}
						aria-invalid={errors.callbackPort ? true : undefined}
						aria-describedby={describedBy(ids.callbackPort, false, Boolean(errors.callbackPort))}
						className={FIELD}
					/>
				</Field>
			</div>
			{saveError && (
				<Callout tone="danger" icon={CircleAlert} role="alert">
					Cannot save the OAuth client: {saveError}
				</Callout>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2">
				{replacing && connected && <p className="me-auto text-xs text-muted-foreground">If you change the client ID or the secret, omp signs out of Google Calendar until you connect again.</p>}
				<Button type="button" variant="ghost" size="compact" disabled={saving} onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" size="compact" loading={saving}>
					{replacing ? "Replace OAuth client" : "Save OAuth client"}
				</Button>
			</div>
		</form>
	);
}

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
