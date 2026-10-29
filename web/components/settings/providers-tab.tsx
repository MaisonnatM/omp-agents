import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle, LogOut, Plus, RefreshCw } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { type LoginPrompt, type ModelProvider, type ProviderAccount, type ProviderLogin, type ProvidersAnswer, providerConnected } from "../../../src/shared/providers";
import { errorText } from "../../../src/json";
import { putJson } from "../../api";
import { readTime } from "../../labels";
import { providersStore } from "../../reads";
import { MoreActionsMenu } from "../more-actions-menu";
import { LoadNote } from "../sheet-details";
import { Callout, IntegrationList, MetaDot } from "../integrations/integration-row";
import { Section } from "./editor";
import { ProviderLogo } from "./provider-logos";

/** How often the page asks again while a sign-in runs, so its page, code, and question show soon after the provider names them. */
const LOGIN_POLL_MS = 1_000;

const refresh = (): Promise<void> => providersStore.refresh();
const cancelLogin = async (): Promise<void> => {
	await putJson("/api/providers/login/cancel", {});
	await refresh();
};

/** The question a running sign-in waits on, masked when the provider marks the answer secret. */
function PromptForm({ prompt }: { prompt: LoginPrompt }) {
	const [value, setValue] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		setSending(true);
		setError(null);
		try {
			await putJson("/api/providers/login/answer", { prompt: prompt.id, value });
			await refresh();
		} catch (err) {
			setError(errorText(err));
			setSending(false);
		}
	};

	return (
		<form className="space-y-1.5" onSubmit={event => void submit(event)}>
			<label className="block space-y-1 text-[13px]">
				<span>{prompt.message}</span>
				<input
					autoFocus
					type={prompt.secret ? "password" : "text"}
					autoComplete="off"
					spellCheck={false}
					value={value}
					onChange={event => setValue(event.target.value)}
					placeholder={prompt.placeholder ?? undefined}
					className="block h-7 w-full rounded-md border border-border bg-transparent px-2 font-mono text-xs"
				/>
			</label>
			<div className="flex items-center gap-2">
				<Button type="submit" size="compact" loading={sending} disabled={!prompt.allowEmpty && value.trim() === ""}>
					Continue
				</Button>
				{error && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{error}
					</p>
				)}
			</div>
		</form>
	);
}

/** Where the sign-in for this row stands: the page to open and its question while it runs, then how it ended. */
function LoginCallout({ login }: { login: ProviderLogin }) {
	if (login.phase === "failed") {
		return (
			<Callout
				tone="danger"
				icon={CircleAlert}
				role="alert"
				action={
					<Button variant="ghost" size="compact" onClick={() => void cancelLogin()}>
						Dismiss
					</Button>
				}
			>
				Sign-in failed: {login.error}
			</Callout>
		);
	}
	if (login.phase === "done") {
		return (
			<Callout
				tone="info"
				icon={CircleCheck}
				role="alert"
				action={
					<Button variant="ghost" size="compact" onClick={() => void cancelLogin()}>
						Dismiss
					</Button>
				}
			>
				{login.identity ? `Signed in as ${login.identity}.` : "Signed in."} New omp sessions can use its models.
			</Callout>
		);
	}
	const { url, instructions, progress, prompt } = login;
	return (
		<div className="space-y-3">
			<Callout
				tone="info"
				icon={LoaderCircle}
				role="status"
				spin
				action={
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="compact" onClick={() => void cancelLogin()}>
							Cancel
						</Button>
						{url && (
							<Button variant="secondary" size="compact" leadingIcon={ExternalLink} render={<a href={url} target="_blank" rel="noreferrer" />}>
								Open sign-in page
							</Button>
						)}
					</div>
				}
			>
				<p className="whitespace-pre-wrap">{instructions ?? (url ? "Sign in on the provider's page." : "Starting the sign-in…")}</p>
				{progress && <p className="mt-1 text-xs opacity-80">{progress}</p>}
			</Callout>
			{prompt && <PromptForm key={prompt.id} prompt={prompt} />}
		</div>
	);
}

/** One stored credential, and the question that signs omp out of it. */
function AccountLine({ provider, account }: { provider: ModelProvider; account: ProviderAccount }) {
	const [confirming, setConfirming] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const signOut = async (): Promise<void> => {
		setSigningOut(true);
		setError(null);
		try {
			const answer = await putJson<ProvidersAnswer>("/api/providers/sign-out", { provider: provider.id, credentialId: account.credentialId });
			providersStore.update(() => answer);
		} catch (err) {
			setError(errorText(err));
			setSigningOut(false);
		}
	};

	if (confirming) {
		return (
			<Callout
				tone="danger"
				icon={LogOut}
				role="group"
				label={`Sign omp out of ${account.label}?`}
				action={
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="compact" autoFocus disabled={signingOut} onClick={() => setConfirming(false)}>
							Cancel
						</Button>
						<Button size="compact" loading={signingOut} onClick={() => void signOut()}>
							Sign out
						</Button>
					</div>
				}
			>
				Remove {account.label} from omp? Sessions stop using it for {provider.name}.
				{error && (
					<p role="alert" className="mt-1">
						Sign-out failed: {error}
					</p>
				)}
			</Callout>
		);
	}
	return (
		<div className="flex items-center gap-3 text-[13px]">
			<div className="min-w-0 flex-1">
				<span className="truncate">{account.label}</span>
				<span className="ms-2 text-xs text-muted-foreground">{account.kind === "oauth" ? "Sign-in" : "API key"}</span>
			</div>
			<Button variant="ghost" size="compact" leadingIcon={LogOut} onClick={() => setConfirming(true)}>
				Sign out
			</Button>
		</div>
	);
}

/** One provider: its accounts, the buttons that sign in, and the sign-in under way for it. */
function ProviderRow({ provider, login }: { provider: ModelProvider; login: ProviderLogin | null }) {
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);
	const connected = providerConnected(provider);
	const running = login?.phase === "running";
	const [first, ...others] = provider.methods;

	const start = async (method: string): Promise<void> => {
		setStarting(true);
		setStartError(null);
		try {
			const answer = await putJson<ProvidersAnswer>("/api/providers/login", { method });
			providersStore.update(() => answer);
		} catch (err) {
			setStartError(errorText(err));
		} finally {
			setStarting(false);
		}
	};

	const verb = connected ? "Add account" : "Connect";
	const actions = running ? null : (
		<>
			{!connected && (
				<Button variant="secondary" size="compact" loading={starting} onClick={() => void start(first!.id)}>
					Connect
				</Button>
			)}
			{(connected || others.length > 0) && (
				<MoreActionsMenu name={provider.name} disabled={starting}>
					{(connected ? provider.methods : others).map(method => (
						<MenuItem key={method.id} onClick={() => void start(method.id)}>
							<Plus />
							{method.id === first!.id ? verb : `${verb} with ${method.name}`}
						</MenuItem>
					))}
				</MoreActionsMenu>
			)}
		</>
	);

	const hasDetails = provider.accounts.length > 0 || provider.envKey !== null || login !== null || startError !== null;
	return (
		<li className="px-4 py-3">
			<div className="flex items-center gap-3">
				<ProviderLogo id={provider.id} name={provider.name} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h3 className="truncate text-[13px] font-medium">{provider.name}</h3>
						{running ? (
							<Badge variant="dot" size="compact" color="blue">
								Signing in
							</Badge>
						) : (
							connected && (
								<Badge variant="dot" size="compact" color="green">
									Connected
								</Badge>
							)
						)}
					</div>
					<div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
						<span className="font-mono">{provider.id}</span>
						{provider.accounts.length > 1 && (
							<>
								<MetaDot />
								<span>{provider.accounts.length} accounts</span>
							</>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">{actions}</div>
			</div>
			{hasDetails && (
				<div className="mt-2.5 space-y-2.5 ps-11">
					{provider.accounts.map(account => (
						<AccountLine key={account.credentialId} provider={provider} account={account} />
					))}
					{provider.envKey && (
						<p className="text-xs text-muted-foreground">
							omp reads its key from <code className="font-mono text-foreground">{provider.envKey}</code>; unset it there to sign out. A sign-in here takes precedence over it.
						</p>
					)}
					{login && <LoginCallout login={login} />}
					{startError && (
						<Callout tone="danger" icon={CircleAlert} role="alert">
							Cannot start the sign-in: {startError}
						</Callout>
					)}
				</div>
			)}
		</li>
	);
}

/** A titled list of providers, absent while it has none. */
function Group({ title, count, providers, login, filter }: { title: string; count: number; providers: ModelProvider[]; login: ProviderLogin | null; filter?: ReactNode }) {
	if (count === 0) return null;
	return (
		<section className="space-y-2.5">
			<div className="flex items-center justify-between gap-3 px-1">
				<h4 className="flex items-baseline gap-2 text-[13px] font-medium">
					{title}
					<span className="text-muted-foreground tabular-nums">{count}</span>
				</h4>
				{filter}
			</div>
			{providers.length > 0 ? (
				<IntegrationList label={title}>
					{providers.map(provider => (
						<ProviderRow key={provider.id} provider={provider} login={login?.provider === provider.id ? login : null} />
					))}
				</IntegrationList>
			) : (
				<p className="px-1 text-xs text-muted-foreground">No provider matches.</p>
			)}
		</section>
	);
}

const matches = (provider: ModelProvider, query: string): boolean => {
	const needle = query.trim().toLowerCase();
	return needle === "" || provider.name.toLowerCase().includes(needle) || provider.methods.some(({ id }) => id.includes(needle));
};

/** Connected providers, then a searchable list of the rest, each with its sign-in. */
export function ProviderGroups({ answer: { providers, login } }: { answer: ProvidersAnswer }) {
	const [query, setQuery] = useState("");
	const connected = providers.filter(providerConnected);
	const available = providers.filter(provider => !providerConnected(provider));
	const shown = available.filter(provider => matches(provider, query) || login?.provider === provider.id);
	return (
		<div className="space-y-8">
			<Group title="Connected" count={connected.length} providers={connected} login={login} />
			<Group
				title="Available"
				count={available.length}
				providers={shown}
				login={login}
				filter={
					<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm">
						<span className="sr-only">Search providers</span>
						<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" className="w-36 bg-transparent outline-none" />
					</label>
				}
			/>
			<p className="px-1 text-xs text-pretty text-muted-foreground">
				omp keeps these credentials in its own store, as <code className="font-mono">omp login</code> does, so every omp session can use them.
			</p>
		</div>
	);
}

/** omp's providers, read while `active`, and read every second while a sign-in runs. */
export function useProviders(active: boolean) {
	const entry = providersStore.usePolling(null, active);
	const running = active && entry.read?.data.login?.phase === "running";
	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => void refresh(), LOGIN_POLL_MS);
		return () => clearInterval(timer);
	}, [running]);
	return entry;
}

/** The model providers omp signs in to, as `/login` and `omp login` do, with the accounts it holds for each. */
export function ProvidersTab({ active }: { active: boolean }) {
	const { read, error, refreshing } = useProviders(active);
	const running = active && read?.data.login?.phase === "running";

	const meta = "The model providers omp signs in to";
	return (
		<Section
			meta={read ? `${meta} · updated ${readTime(read.at)}` : meta}
			actions={
				<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing && !running} onClick={() => void refresh()}>
					{refreshing && !running ? "Refreshing…" : "Refresh"}
				</Button>
			}
		>
			{read ? (
				<>
					{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the providers: {error}</p>}
					<ProviderGroups answer={read.data} />
				</>
			) : (
				<LoadNote loading="Reading omp's providers…" error={error && `Cannot load the providers: ${error}`} />
			)}
		</Section>
	);
}
