import { CircleAlert, CircleCheck, ExternalLink, KeyRound, LoaderCircle, LogOut, Plus, RefreshCw } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { ANTHROPIC_API_KEY_METHOD, type LoginPrompt, type ModelProvider, orderableAccounts, type ProviderAccount, type ProviderLogin, type ProvidersAnswer, providerConnected } from "../../../src/shared/providers";
import { putJson } from "../../api";
import { readTime } from "../../labels";
import { providersStore } from "../../reads";
import { useAction } from "../../use-action";
import { MoreActionsMenu } from "../more-actions-menu";
import { LoadNote } from "../sheet-details";
import { Callout, IntegrationList, MetaDot } from "../integrations/integration-row";
import { Confirm } from "../integrations/mcp-connection-controls";
import { OrderButton, Section } from "./editor";
import { ProviderLogo } from "./provider-logos";

/** How often the page asks again while a sign-in runs, so its page, code, and question show soon after the provider names them. */
const LOGIN_POLL_MS = 1_000;

const refresh = (): Promise<void> => providersStore.refresh();
const cancelLogin = async (): Promise<void> => {
	await putJson("/api/providers/login/cancel", {});
	await refresh();
};

/** The question a running sign-in waits on, masked when the provider marks the answer secret. */
function PromptForm({ prompt, apiKey = false }: { prompt: LoginPrompt; apiKey?: boolean }) {
	const [value, setValue] = useState("");
	const answer = useAction(async () => {
		await putJson("/api/providers/login/answer", { prompt: prompt.id, value });
		setValue("");
		await refresh();
	}, null);
	const sending = answer.pending;
	const error = answer.error;

	const submit = (event: FormEvent): void => {
		event.preventDefault();
		answer.run();
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
					{apiKey ? "Save API key" : "Continue"}
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
	const apiKey = login.method === ANTHROPIC_API_KEY_METHOD;
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
				{apiKey ? "API key save failed" : "Sign-in failed"}: {login.error}
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
				{apiKey ? "API key saved. Pick an API credits model to start a session on it." : `${login.identity ? `Signed in as ${login.identity}.` : "Signed in."} New omp sessions can use its models.`}
			</Callout>
		);
	}
	const { url, instructions, progress, prompt } = login;
	return (
		<div className="space-y-3">
			<Callout
				tone="info"
				icon={apiKey && prompt ? KeyRound : LoaderCircle}
				role="status"
				spin={!apiKey || !prompt}
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
				<p className="whitespace-pre-wrap">{apiKey ? (prompt ? "Paste your Anthropic Console API key below. Sessions on API credits models bill it; your Anthropic sign-in stays as it is." : "Saving API key…") : instructions ?? (url ? "Sign in on the provider's page." : "Starting the sign-in…")}</p>
				{!apiKey && progress && <p className="mt-1 text-xs opacity-80">{progress}</p>}
			</Callout>
			{prompt && <PromptForm key={prompt.id} prompt={prompt} apiKey={apiKey} />}
		</div>
	);
}

/** Where an account sits among the ones Settings orders, and the move that saves a new place. */
interface AccountPlace {
	index: number;
	count: number;
	move: (index: number, by: -1 | 1) => void;
}

/**
 * One stored credential, and the question that signs omp out of it. While the provider's accounts are ordered, `numbered`
 * keeps the place column, and `place` numbers this one and moves it.
 */
function AccountLine({ provider, account, numbered, place }: { provider: ModelProvider; account: ProviderAccount; numbered: boolean; place: AccountPlace | null }) {
	const [confirming, setConfirming] = useState(false);
	if (confirming) {
		// The sign-out lives in the question, so Cancel drops a failure with it.
		return (
			<Confirm
				icon={LogOut}
				question={`Sign omp out of ${account.label}?`}
				detail={`Sessions stop using it for ${provider.name}.`}
				confirm="Sign out"
				run={async () => {
					const answer = await putJson<ProvidersAnswer>("/api/providers/sign-out", { provider: provider.id, credentialId: account.credentialId });
					providersStore.update(() => answer);
				}}
				onDone={() => setConfirming(false)}
			/>
		);
	}
	return (
		<div className="flex items-center gap-3 text-[13px] max-sm:flex-wrap max-sm:justify-end max-sm:gap-y-1">
			{numbered && <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{place && place.index + 1}</span>}
			<div className="min-w-0 flex-1 max-sm:flex max-sm:min-w-3/4 max-sm:items-baseline">
				<span className="truncate max-sm:min-w-0">{account.label}</span>
				<span className="ms-2 text-xs text-muted-foreground max-sm:shrink-0">{account.kind === "oauth" ? "Sign-in" : "API key"}</span>
			</div>
			{place && (
				<div className="flex shrink-0 items-center">
					<OrderButton label={account.label} direction="up" disabled={place.index === 0} onClick={() => place.move(place.index, -1)} />
					<OrderButton label={account.label} direction="down" disabled={place.index === place.count - 1} onClick={() => place.move(place.index, 1)} />
				</div>
			)}
			<Button variant="ghost" size="compact" leadingIcon={LogOut} onClick={() => setConfirming(true)}>
				Sign out
			</Button>
		</div>
	);
}

/** One provider: its accounts, the buttons that sign in, and the sign-in under way for it. */
function ProviderRow({ provider, login }: { provider: ModelProvider; login: ProviderLogin | null }) {
	const start = useAction(async (method: string) => {
		const answer = await putJson<ProvidersAnswer>("/api/providers/login", { method });
		providersStore.update(() => answer);
	}, null);
	const starting = start.pending;
	const startError = start.error;
	const orderable = orderableAccounts(provider.accounts);
	const reorder = useAction(async (emails: string[]) => {
		const answer = await putJson<ProvidersAnswer>("/api/providers/account-order", { provider: provider.id, emails });
		providersStore.update(() => answer);
	}, null);
	const moveAccount = (index: number, by: -1 | 1): void => {
		const emails = orderable.map(({ email }) => email);
		emails.splice(index + by, 0, ...emails.splice(index, 1));
		reorder.run(emails);
	};
	const ordering = orderable.length > 1;
	const connected = providerConnected(provider);
	const running = login?.phase === "running";
	const [first, ...others] = provider.methods;
	const verb = connected ? "Add account" : "Connect";
	const actions = running ? null : (
		<>
			{!connected && (
				<Button variant="secondary" size="compact" loading={starting} onClick={() => start.run(first!.id)}>
					Connect
				</Button>
			)}
			{(connected || others.length > 0) && (
				<MoreActionsMenu name={provider.name} disabled={starting}>
					{(connected ? provider.methods : others).map(method => (
						<MenuItem key={method.id} onClick={() => start.run(method.id)}>
							{method.id === ANTHROPIC_API_KEY_METHOD ? <KeyRound /> : <Plus />}
							{method.id === ANTHROPIC_API_KEY_METHOD ? (provider.accounts.some(account => account.kind === "api_key") ? "Replace API key" : "Add API key") : method.id === first!.id ? verb : `${verb} with ${method.name}`}
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
								{login.method === ANTHROPIC_API_KEY_METHOD ? (login.prompt ? "Enter key" : "Saving key") : "Signing in"}
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
				{/* On a phone, a lone Connect keeps the ⋯ button's room, so it lines up with the Connect of rows that have one. */}
				<div className={cn("flex shrink-0 items-center gap-1.5", !running && !connected && others.length === 0 && "max-sm:pe-8.5")}>{actions}</div>
			</div>
			{hasDetails && (
				<div className="mt-2.5 space-y-2.5 ps-11">
					{provider.accounts.map(account => {
						const index = orderable.findIndex(({ credentialId }) => credentialId === account.credentialId);
						const place = ordering && index >= 0 ? { index, count: orderable.length, move: moveAccount } : null;
						return <AccountLine key={account.credentialId} provider={provider} account={account} numbered={ordering} place={place} />;
					})}
					{ordering && <p className="text-xs text-muted-foreground">omp tries these accounts from the top, and moves to the next when one nears its usage limit or fails.</p>}
					{reorder.error && (
						<Callout tone="danger" icon={CircleAlert} role="alert">
							Cannot save the account order: {reorder.error}
						</Callout>
					)}
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
			<div className="flex items-center justify-between gap-3 px-1 max-sm:px-0">
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
				<p className="px-1 text-xs text-muted-foreground max-sm:px-0">No provider matches.</p>
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
			<p className="px-1 text-xs text-pretty text-muted-foreground max-sm:px-0">
				omp keeps these credentials in its own store, as <code className="font-mono">omp login</code> does, so every omp session can use them.
			</p>
		</div>
	);
}

/** omp's providers, read while `active`, and read every second while a sign-in runs, which `running` says. */
export function useProviders(active: boolean) {
	const entry = providersStore.usePolling(null, active);
	const running = active && entry.read?.data.login?.phase === "running";
	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => void refresh(), LOGIN_POLL_MS);
		return () => clearInterval(timer);
	}, [running]);
	return { ...entry, running };
}

/** The model providers omp signs in to, as `/login` and `omp login` do, with the accounts it holds for each. */
export function ProvidersTab({ active }: { active: boolean }) {
	const { read, error, refreshing, running } = useProviders(active);

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
