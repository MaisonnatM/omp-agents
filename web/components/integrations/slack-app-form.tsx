import { CircleAlert } from "lucide-react";
import { type FormEvent, type RefObject, useId, useRef, useState } from "react";
import { normalizeSlackScope, SLACK_USER_SCOPES, type SlackClientInput, type SlackSetup, slackRedirectError, type McpIntegration } from "../../../src/shared/accounts";
import { Button } from "@/components/ui/button";
import { errorText, putJson } from "../../api";
import { integrationsStore } from "../../reads";
import { CONTROL, describedBy, External, Field, FIELD, Step } from "./client-form";
import { Callout } from "./integration-row";

const FIELD_ORDER = ["clientId", "clientSecret", "redirectUri", "callbackPort", "scope"] as const;

type SetupField = (typeof FIELD_ORDER)[number];

interface SetupDraft {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	callbackPort: string;
	scope: string;
}

type FieldErrors = Partial<Record<SetupField, string>>;

function keepsSavedSecret(saved: SlackSetup | null, clientId: string, clientSecret: string): boolean {
	if (clientSecret.trim() || !saved?.hasClientSecret || saved.clientId === null) return false;
	return clientId.trim() === saved.clientId.trim();
}

function validateSlackSetup(draft: SetupDraft, saved: SlackSetup | null): FieldErrors {
	const errors: FieldErrors = {};
	const clientId = draft.clientId.trim();
	const clientSecret = draft.clientSecret.trim();
	const redirectUri = draft.redirectUri.trim();
	if (!clientId) errors.clientId = "Enter the Slack app's client ID.";
	if (!clientSecret && !keepsSavedSecret(saved, clientId, clientSecret)) {
		errors.clientSecret = saved?.hasClientSecret
			? "Enter the new app's client secret. A blank secret only keeps the saved one for the same client ID."
			: "Enter the Slack app's client secret.";
	}

	const portText = draft.callbackPort.trim();
	const port = /^\d+$/.test(portText) ? Number(portText) : Number.NaN;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		errors.callbackPort = "Enter a callback port from 1 to 65535.";
	}
	const redirectError = slackRedirectError(redirectUri, port);
	if (redirectError) errors.redirectUri = redirectError;
	if (!normalizeSlackScope(draft.scope)) errors.scope = "Choose at least one of the listed user scopes.";
	return errors;
}

interface SlackAppFormProps {
	setup: SlackSetup | null;
	connected: boolean;
	onDone: () => void;
}

export function SlackAppForm({ setup, connected, onDone }: SlackAppFormProps) {
	const baseId = useId();
	const clientIdId = `${baseId}-client-id`;
	const secretId = `${baseId}-client-secret`;
	const redirectId = `${baseId}-redirect`;
	const portId = `${baseId}-port`;
	const scopeId = `${baseId}-scope`;
	const clientIdRef = useRef<HTMLInputElement>(null);
	const secretRef = useRef<HTMLInputElement>(null);
	const redirectRef = useRef<HTMLInputElement>(null);
	const portRef = useRef<HTMLInputElement>(null);
	const scopeRef = useRef<HTMLTextAreaElement>(null);
	const refs: Record<SetupField, RefObject<HTMLInputElement | HTMLTextAreaElement | null>> = {
		clientId: clientIdRef,
		clientSecret: secretRef,
		redirectUri: redirectRef,
		callbackPort: portRef,
		scope: scopeRef,
	};

	const [clientId, setClientId] = useState(setup?.clientId ?? "");
	const [clientSecret, setClientSecret] = useState("");
	const [redirectUri, setRedirectUri] = useState(setup?.redirectUri ?? "");
	const [callbackPort, setCallbackPort] = useState(String(setup?.callbackPort ?? 3000));
	const [scope, setScope] = useState(setup?.scope.trim() ? setup.scope : SLACK_USER_SCOPES.join(" "));
	const [errors, setErrors] = useState<FieldErrors>({});
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const replacing = setup?.configured === true || setup?.hasClientSecret === true || Boolean(setup?.clientId);

	const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (saving) return;
		const draft = { clientId, clientSecret, redirectUri, callbackPort, scope };
		const next = validateSlackSetup(draft, setup);
		setErrors(next);
		setSaveError(null);
		const first = FIELD_ORDER.find(field => next[field]);
		if (first) {
			refs[first].current?.focus();
			return;
		}
		const secret = clientSecret.trim();
		const body: SlackClientInput = {
			clientId: clientId.trim(),
			redirectUri: redirectUri.trim(),
			callbackPort: Number(callbackPort.trim()),
			scope: scope.trim(),
		};
		if (secret) body.clientSecret = secret;
		setSaving(true);
		try {
			await putJson<McpIntegration>("/api/integrations/slack/client", body);
			await integrationsStore.refresh();
			onDone();
		} catch (err) {
			const message = errorText(err);
			setSaveError(secret ? message.replaceAll(secret, "the client secret") : message);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form aria-label="Slack app settings" noValidate onSubmit={event => void save(event)} className="space-y-4 rounded-lg bg-muted/60 p-4 text-[13px]">
			<ol className="space-y-2.5">
				<Step n={1}>
					Create a new internal app in <External href="https://api.slack.com/apps">Your Slack apps</External>. Leave any existing production app unchanged.
				</Step>
				<Step n={2}>
					Open Agents and turn on Slack Model Context Protocol (MCP) Server. <External href="https://docs.slack.dev/ai/slack-mcp-server">Slack's MCP server guide</External> names that control.
				</Step>
				<Step n={3}>Add user scopes for the conversations omp may search, read, and send. A smaller read-only set is fine. Leave canvas, list, file, and reaction scopes off.</Step>
				<Step n={4}>Turn on token rotation for this new app.</Step>
				<Step n={5}>Register an HTTPS redirect URL. A TLS terminator you trust must forward it to the HTTP callback on this machine. HTTP localhost does not work. If the redirect is HTTPS on localhost, the callback port must differ from that HTTPS port.</Step>
				<Step n={6}>Slack requires confidential OAuth. Paste the app's client ID and client secret. This page does not show the secret again.</Step>
			</ol>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field id={clientIdId} label="Client ID" error={errors.clientId}>
					<input
						ref={clientIdRef}
						id={clientIdId}
						name="slack-client-id"
						type="text"
						autoComplete="off"
						spellCheck={false}
						autoFocus
						value={clientId}
						autoCapitalize="none"
						onChange={event => {
							setClientId(event.target.value);
							setErrors(current => (current.clientId ? { ...current, clientId: undefined } : current));
						}}
						aria-invalid={errors.clientId ? true : undefined}
						aria-describedby={describedBy(clientIdId, false, Boolean(errors.clientId))}
						placeholder="1234567890.1234567890"
						className={FIELD}
					/>
				</Field>
				<Field id={secretId} label="Client secret" hint={setup?.hasClientSecret ? "A secret is saved for this client ID. Leave this blank to keep it." : undefined} error={errors.clientSecret}>
					<input
						ref={secretRef}
						id={secretId}
						name="slack-client-secret"
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={clientSecret}
						autoCapitalize="none"
						onChange={event => {
							setClientSecret(event.target.value);
							setErrors(current => (current.clientSecret ? { ...current, clientSecret: undefined } : current));
						}}
						aria-invalid={errors.clientSecret ? true : undefined}
						aria-describedby={describedBy(secretId, Boolean(setup?.hasClientSecret), Boolean(errors.clientSecret))}
						className={FIELD}
					/>
				</Field>
			</div>
			<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
				<Field id={redirectId} label="Redirect URL" hint="The HTTPS URL registered on the Slack app." error={errors.redirectUri}>
					<input
						ref={redirectRef}
						id={redirectId}
						name="slack-redirect-uri"
						type="text"
						inputMode="url"
						autoComplete="off"
						spellCheck={false}
						value={redirectUri}
						autoCapitalize="none"
						onChange={event => {
							setRedirectUri(event.target.value);
							setErrors(current => (current.redirectUri ? { ...current, redirectUri: undefined } : current));
						}}
						aria-invalid={errors.redirectUri ? true : undefined}
						aria-describedby={describedBy(redirectId, true, Boolean(errors.redirectUri))}
						placeholder="https://oauth.example.com/slack/callback"
						className={FIELD}
					/>
				</Field>
				<Field id={portId} label="Callback port" hint="omp listens for HTTP on localhost at this port." error={errors.callbackPort}>
					<input
						ref={portRef}
						id={portId}
						name="slack-callback-port"
						type="text"
						inputMode="numeric"
						autoComplete="off"
						spellCheck={false}
						value={callbackPort}
						onChange={event => {
							setCallbackPort(event.target.value);
							setErrors(current => (current.callbackPort ? { ...current, callbackPort: undefined } : current));
						}}
						aria-invalid={errors.callbackPort ? true : undefined}
						aria-describedby={describedBy(portId, true, Boolean(errors.callbackPort))}
						className={FIELD}
					/>
				</Field>
			</div>
			<Field id={scopeId} label="User scopes" hint={`Requested on your next sign-in. Spaces or commas. Accepted scopes: ${SLACK_USER_SCOPES.join(", ")}.`} error={errors.scope}>
				<textarea
					ref={scopeRef}
					id={scopeId}
					name="slack-scope"
					rows={3}
					autoComplete="off"
					spellCheck={false}
					value={scope}
					autoCapitalize="none"
					onChange={event => {
						setScope(event.target.value);
						setErrors(current => (current.scope ? { ...current, scope: undefined } : current));
					}}
					onKeyDown={event => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
					aria-invalid={errors.scope ? true : undefined}
					aria-describedby={describedBy(scopeId, true, Boolean(errors.scope))}
					className={`${CONTROL} block min-h-16 py-1.5 font-mono text-xs`}
				/>
			</Field>
			<Callout tone="warning" icon={CircleAlert}>
				Token rotation is irreversible. Turn it on in Slack for this new app only. Slack cannot turn it off later. A sign-in without a refresh token is refused.
			</Callout>
			{saveError && (
				<Callout tone="danger" icon={CircleAlert} role="alert">
					Cannot save the app settings: {saveError}
				</Callout>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2">
				{replacing && connected && <p className="me-auto text-xs text-muted-foreground">If you change the client ID or the secret, omp signs out of Slack until you connect again.</p>}
				<Button type="button" variant="ghost" size="compact" disabled={saving} onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" size="compact" loading={saving}>
					{replacing ? "Replace app settings" : "Save app settings"}
				</Button>
			</div>
		</form>
	);
}
