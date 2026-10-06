import { CircleAlert, ExternalLink, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { GoogleStatus, SignInState } from "../../../src/shared/accounts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { googleStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { FIELD } from "../settings/editor";
import { GOOGLE_CALENDAR_LOGO } from "./brand-logos";
import { Callout, IntegrationRow, MetaDot, RowMenu } from "./integration-row";

const NAME = "Google Calendar";

const startGoogleSignIn = async (): Promise<SignInState> => (await putJson<GoogleStatus>("/api/google/sign-in", {})).signIn;

/** One numbered step of the OAuth client's setup. */
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

interface ClientFormProps {
	id: string;
	replacing: boolean;
	connected: boolean;
	onDone: () => void;
}

/** The steps to create a desktop OAuth client in Google Cloud, then its ID and secret. */
function ClientForm({ id, replacing, connected, onDone }: ClientFormProps) {
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
			await googleStore.refresh();
			onDone();
		} catch (err) {
			setSaveError(errorText(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<form id={id} aria-label="OAuth client" onSubmit={event => void save(event)} className="space-y-4 rounded-lg bg-muted/60 p-4 text-[13px]">
			<ol className="space-y-2.5">
				<Step n={1}>
					Open{" "}
					<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline decoration-border underline-offset-2 hover:decoration-foreground">
						Google Cloud credentials
						<ExternalLink aria-hidden className="size-3" />
					</a>{" "}
					and enable the Google Calendar API.
				</Step>
				<Step n={2}>Create an OAuth client of type Desktop. An internal consent screen keeps it to your Workspace.</Step>
				<Step n={3}>Paste its ID and secret here. Both stay on this machine.</Step>
			</ol>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="space-y-1">
					<span className="text-xs font-medium">Client ID</span>
					<input name="google-client-id" type="text" autoComplete="off" autoFocus value={clientId} onChange={event => setClientId(event.target.value)} required placeholder="…apps.googleusercontent.com" className={cn(FIELD, "block h-8 w-full")} />
				</label>
				<label className="space-y-1">
					<span className="text-xs font-medium">Client secret</span>
					<input name="google-client-secret" type="password" autoComplete="off" value={clientSecret} onChange={event => setClientSecret(event.target.value)} required className={cn(FIELD, "block h-8 w-full")} />
				</label>
			</div>
			{saveError && (
				<Callout tone="danger" icon={CircleAlert}>
					Cannot save the OAuth client: {saveError}
				</Callout>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2">
				{replacing && connected && <p className="me-auto text-xs text-muted-foreground">Replacing it signs out of Google Calendar until you connect again.</p>}
				<Button type="button" variant="ghost" size="compact" disabled={saving} onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" size="compact" loading={saving}>
					{replacing ? "Replace client" : "Save client"}
				</Button>
			</div>
		</form>
	);
}

interface GoogleCalendarRowProps {
	/** The last read of `/api/google`, `null` until one succeeds. */
	status: GoogleStatus | null;
	error: string | null;
}

/** Google Calendar: its OAuth client and its read-only sign-in, both owned by this dashboard rather than by omp. */
export function GoogleCalendarRow({ status, error }: GoogleCalendarRowProps) {
	const { starting, waitingUrl, failure, connect } = useSignIn(status?.signIn ?? null, googleStore.refresh, startGoogleSignIn);
	const [formOpen, setFormOpen] = useState(false);
	const formId = useId();
	const clientId = status?.clientId ?? null;
	const connected = status?.connected ?? false;

	let badge;
	if (waitingUrl) badge = <Badge variant="dot" size="compact" color="blue">Waiting for you</Badge>;
	else if (connected) badge = <Badge variant="dot" size="compact" color="green">Connected</Badge>;
	else if (status) badge = <Badge variant="dot" size="compact" color="gray">{clientId ? "Not connected" : "Not set up"}</Badge>;

	let actions;
	if (formOpen) actions = null;
	else if (!clientId) {
		actions = (
			<Button variant="secondary" size="compact" disabled={!status} onClick={() => setFormOpen(true)}>
				Set up
			</Button>
		);
	} else {
		actions = (
			<>
				{!connected && !waitingUrl && (
					<Button variant="secondary" size="compact" loading={starting} onClick={() => void connect()}>
						Connect
					</Button>
				)}
				<RowMenu name={NAME} disabled={starting}>
					{connected && (
						<MenuItem onClick={() => void connect()}>
							<RefreshCw />
							Reconnect
						</MenuItem>
					)}
					<MenuItem onClick={() => setFormOpen(true)}>
						<KeyRound />
						Replace OAuth client
					</MenuItem>
				</RowMenu>
			</>
		);
	}

	return (
		<IntegrationRow
			name={NAME}
			logo={GOOGLE_CALENDAR_LOGO}
			summary="Events from the calendars you pick, on the Calendar tab. Read-only."
			status={badge}
			meta={
				<>
					<span>OAuth</span>
					<MetaDot />
					<span>This dashboard only</span>
					{clientId && (
						<>
							<MetaDot />
							<span className="max-w-56 truncate font-mono" title={clientId}>
								{clientId}
							</span>
						</>
					)}
				</>
			}
			actions={actions}
		>
			{!status && error && (
				<Callout tone="danger" icon={CircleAlert}>
					Cannot check Google Calendar: {error}
				</Callout>
			)}
			{waitingUrl && (
				<Callout
					tone="info"
					icon={LoaderCircle}
					spin
					action={
						<Button variant="ghost" size="compact" leadingIcon={ExternalLink} render={<a href={waitingUrl} target="_blank" rel="noreferrer" />}>
							Open sign-in page
						</Button>
					}
				>
					Approve read-only calendar access on Google in the tab that opened. This updates on its own.
				</Callout>
			)}
			{failure && !waitingUrl && (
				<Callout tone="danger" icon={CircleAlert}>
					Sign-in failed: {failure}
				</Callout>
			)}
			{formOpen && <ClientForm id={formId} replacing={clientId !== null} connected={connected} onDone={() => setFormOpen(false)} />}
		</IntegrationRow>
	);
}
