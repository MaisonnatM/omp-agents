import { CalendarDays, Plug } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { GoogleStatus } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { googleStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { FIELD, Section } from "./editor";

/** The Google Calendar OAuth client and its read-only sign-in, both owned by this dashboard rather than by omp. */
export function GoogleConnection() {
	const { status, error, starting, waitingUrl, failure, connect } = useSignIn<GoogleStatus>(googleStore, "/api/google/sign-in");
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		setSaving(true);
		setSaveError(null);
		try {
			await putJson<GoogleStatus>("/api/google/client", { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
			setClientId("");
			setClientSecret("");
			await googleStore.refresh();
		} catch (err) {
			setSaveError(errorText(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Section
			title="Google Calendar"
			meta="Read-only access to events in the calendars selected in Google Calendar. Your OAuth secret and refresh token stay on this machine."
			actions={
				<Button variant={status?.connected ? "ghost" : "primary"} size="compact" leadingIcon={Plug} loading={starting} disabled={!status?.clientId || saving} onClick={() => void connect()}>
					{status?.connected ? "Sign in again" : "Connect Google"}
				</Button>
			}
		>
			<div className="space-y-4 text-sm">
				{status?.connected ? (
					<p>Connected. The Calendar tab lists events from your selected Google calendars.</p>
				) : status?.clientId ? (
					<p className="text-muted-foreground">Client saved. Connect Google to show your events in the Calendar tab.</p>
				) : error ? (
					<p role="alert" className="text-red-600 dark:text-red-400">Cannot check Google Calendar's connection: {error}</p>
				) : (
					<p className="text-muted-foreground">Create a Desktop OAuth client in Google Cloud, then paste its client ID and secret below.</p>
				)}
				{status?.clientId && <p className="text-muted-foreground">Client ID: <span className="select-all font-mono text-foreground">{status.clientId}</span></p>}
				{waitingUrl && (
					<p className="text-muted-foreground">
						Waiting for you to approve read-only calendar access on Google.{" "}
						<a href={waitingUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">Open Google's sign-in page</a>
					</p>
				)}
				{failure && <p role="alert" className="text-red-600 dark:text-red-400">Sign-in failed: {failure}</p>}
				<form onSubmit={event => void save(event)} className="space-y-3">
					<p className="text-muted-foreground">
						<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">Open Google Cloud credentials</a>.
						Enable the Google Calendar API and create an OAuth client with application type Desktop. Use an internal consent screen if your Workspace allows it.
					</p>
					<div className="flex flex-wrap gap-3">
						<label className="min-w-56 flex-1 space-y-1">Client ID
							<input name="google-client-id" type="text" autoComplete="off" value={clientId} onChange={event => setClientId(event.target.value)} required placeholder="…apps.googleusercontent.com" className={cn(FIELD, "block w-full")} />
						</label>
						<label className="min-w-56 flex-1 space-y-1">Client secret
							<input name="google-client-secret" type="password" autoComplete="off" value={clientSecret} onChange={event => setClientSecret(event.target.value)} required className={cn(FIELD, "block w-full")} />
						</label>
					</div>
					<Button type="submit" variant="secondary" size="compact" leadingIcon={CalendarDays} loading={saving} disabled={starting}>{status?.clientId ? "Replace OAuth client" : "Save OAuth client"}</Button>
					{status?.connected && <p className="text-muted-foreground">Replacing the OAuth client signs out of Google Calendar until you connect again.</p>}
					{saveError && <p role="alert" className="text-red-600 dark:text-red-400">Cannot save OAuth client: {saveError}</p>}
				</form>
			</div>
		</Section>
	);
}
