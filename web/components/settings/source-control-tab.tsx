import { ExternalLink, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
	MERGE_METHOD_LABELS,
	MERGE_METHODS,
	type MergeMethodChoice,
	type ProviderStatus,
	type PullOutcome,
	type PullRepo,
	type SourceControlAnswer,
	type SourceControlChange,
	type SourceControlProvider,
} from "../../../src/shared/source-control";
import { errorText } from "../../../src/json";
import { putJson } from "../../api";
import { useEditableRead } from "../../editable-read";
import { age, folderName } from "../../labels";
import { useMergeMethodChoice } from "../../merge-method";
import { IntegrationList } from "../integrations/integration-row";
import { OrgIcon } from "../org-icon";
import { FIELD, Section } from "./editor";
import { ToggleSwitch } from "../toggle-switch";

const PROVIDERS: Record<SourceControlProvider, { name: string; summary: string; signIn: string }> = {
	github: { name: "GitHub", summary: "Reads your pull requests, changes them, and merges them through the gh CLI.", signIn: "gh auth login" },
	graphite: { name: "Graphite", summary: "Opens your pull requests on Graphite, and lets sessions submit stacks with the gt CLI.", signIn: "gt auth --token <token>" },
};

/** Where Graphite hands out the token `gt auth` takes. */
const GRAPHITE_TOKEN_PAGE = "https://app.graphite.com/activate";

/** A Graphite token field that signs `gt` in on the server. */
function GraphiteSignIn({ signIn }: { signIn: (token: string) => Promise<void> }) {
	const [token, setToken] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			await signIn(token.trim());
		} catch (err) {
			setError(errorText(err));
		} finally {
			setPending(false);
		}
	};
	return (
		<form className="mt-2 space-y-2" onSubmit={submit}>
			<div className="flex flex-wrap items-end gap-2">
				<label className="space-y-1 text-xs text-muted-foreground">
					Graphite token
					<input
						name="graphite-token"
						type="password"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						value={token}
						onChange={event => setToken(event.target.value)}
						className={`${FIELD} block w-72 max-w-full text-foreground`}
					/>
				</label>
				<Button type="submit" variant="secondary" size="compact" loading={pending} disabled={pending || token.trim() === ""}>
					Sign in
				</Button>
				<Button variant="ghost" size="compact" leadingIcon={ExternalLink} render={<a href={GRAPHITE_TOKEN_PAGE} target="_blank" rel="noreferrer" />}>
					Get a token
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
		</form>
	);
}

function ProviderRow({ status, signInGraphite }: { status: ProviderStatus; signInGraphite: (token: string) => Promise<void> }) {
	const { name, summary, signIn } = PROVIDERS[status.provider];
	const cli = status.provider === "github" ? "gh" : "gt";
	const inline = status.provider === "graphite" && status.state === "signed-out";
	const fact = {
		missing: status.provider === "graphite" ? `gt is not installed. Once it is, run ${signIn} in a terminal to sign in` : `${cli} is not installed`,
		"signed-out": inline ? `Paste a token from Graphite to sign ${cli} in` : `Run ${signIn} in a terminal to sign in`,
		"signed-in": status.account ? `Signed in as ${status.account}` : `${cli} is signed in`,
	}[status.state];
	return (
		<li className="flex items-start gap-3.5 p-4">
			<span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-5 shadow-surface-2">
				<OrgIcon org={status.provider} className="size-5" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<h3 className="text-[13px] font-medium">{name}</h3>
					{status.state === "signed-in" && (
						<Badge variant="dot" size="compact" color="green">
							Connected
						</Badge>
					)}
				</div>
				<p className="mt-0.5 text-[13px] text-pretty text-muted-foreground">{summary}</p>
				<p className="mt-1.5 text-xs text-muted-foreground">{fact}</p>
				{inline && <GraphiteSignIn signIn={signInGraphite} />}
			</div>
		</li>
	);
}

const SKIPPED: Record<Extract<PullOutcome, { kind: "skipped" }>["reason"], string> = { changes: "Skipped: local changes", commits: "Skipped: local commits", "no-default-branch": "Skipped: no default branch", failed: "Failed" };

function outcomeLabel(outcome: PullOutcome): string {
	if (outcome.kind === "current") return "Up to date";
	if (outcome.kind === "pulled") return `Pulled ${outcome.commits} commit${outcome.commits === 1 ? "" : "s"}`;
	return outcome.detail ? `${SKIPPED[outcome.reason]}: ${outcome.detail}` : SKIPPED[outcome.reason];
}

function lastPull(repo: PullRepo): string {
	return repo.last ? `${outcomeLabel(repo.last.outcome)} · ${age(repo.last.at)} ago` : "Not pulled since the dashboard started";
}

type RepoPull = "default" | "on" | "off";

const MERGE_METHOD_CHOICES: Record<MergeMethodChoice, string> = { last: "Last selected", ...MERGE_METHOD_LABELS };

/** GitHub's and Graphite's CLIs, automatic pulls by default and per repository, the cleanup after a merge, and the merge button's starting method. */
export function SourceControlTab({ active }: { active: boolean }) {
	const read = useEditableRead<SourceControlAnswer>(active ? "/api/source-control" : null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [choice, setChoice] = useMergeMethodChoice();
	const change = async (next: SourceControlChange): Promise<void> => {
		setPending(true);
		setError(null);
		try {
			await read.write(() => putJson<SourceControlAnswer>("/api/source-control", next));
		} catch (err) {
			setError(errorText(err));
		} finally {
			setPending(false);
		}
	};
	const signInGraphite = async (token: string): Promise<void> => {
		await read.write(() => putJson<SourceControlAnswer>("/api/source-control/graphite-sign-in", { token }));
	};
	const answer = read.data;
	const on = answer?.autoPull.on ?? false;
	return (
		<>
			<Section
				title="Command-line tools"
				meta="The command-line tools the dashboard and your sessions reach GitHub and Graphite through."
				actions={
					<Button variant="ghost" size="compact" leadingIcon={RefreshCw} onClick={read.reload}>
						Check again
					</Button>
				}
			>
				{read.error && <p className="text-xs text-red-600 dark:text-red-400">{read.error}</p>}
				{answer && (
					<IntegrationList label="Command-line tools">
						{answer.providers.map(status => (
							<ProviderRow key={status.provider} status={status} signInGraphite={signInGraphite} />
						))}
					</IntegrationList>
				)}
			</Section>
			<Section title="Automatically pull" meta="Keeps the default branch current when the checkout has no local changes or commits. Projects can override it.">
				<p className="text-xs text-muted-foreground">Each repository your workspaces use is a project; its own choice wins over the default.</p>
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
					<ToggleSwitch aria-label="Automatically pull" checked={on} disabled={!answer || pending} onCheckedChange={next => void change({ op: "default", on: next })} />
					Pull every five minutes
				</label>
				{error && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{error}
					</p>
				)}
				{answer && answer.repos.length > 0 && (
					<IntegrationList label="Repositories">
						{answer.repos.map(repo => (
							<li key={repo.path} className="flex items-center gap-3 px-4 py-2.5">
								<div className="min-w-0 flex-1">
									<p className="truncate text-[13px] font-medium">{folderName(repo.path) ?? repo.path}</p>
									<p className="truncate text-xs text-muted-foreground">
										{repo.pathDisplay} · {lastPull(repo)}
									</p>
								</div>
								<Select<RepoPull>
									items={{ default: `Default (${on ? "on" : "off"})`, on: "On", off: "Off" }}
									disabled={pending}
									value={repo.on === null ? "default" : repo.on ? "on" : "off"}
									onValueChange={next => next && void change({ op: "repo", repo: repo.path, on: next === "default" ? null : next === "on" })}
								>
									<SelectTrigger aria-label={`Automatically pull ${folderName(repo.path) ?? repo.path}`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="default">Default ({on ? "on" : "off"})</SelectItem>
										<SelectItem value="on">On</SelectItem>
										<SelectItem value="off">Off</SelectItem>
									</SelectContent>
								</Select>
							</li>
						))}
					</IntegrationList>
				)}
			</Section>
			<Section title="After a merge" meta="Once a pull request merges, from the dashboard or anywhere else, each session the dashboard started that it leaves idle with every pull request merged or closed ends.">
				<p className="text-xs text-muted-foreground">Its linked worktree and the merged branch go too, unless another session still works there, the worktree has changes, or the branch has commits the merge did not take. Sessions you run in a terminal never end. A project's workers follow the project's own setting.</p>
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
					<ToggleSwitch aria-label="Clean up after a merge" checked={answer?.cleanUp ?? true} disabled={!answer || pending} onCheckedChange={next => void change({ op: "clean-up", on: next })} />
					End finished sessions and remove their worktrees and branches
				</label>
			</Section>
			<Section title="Default merge method" meta="Pull requests start with this method. Last selected reuses the method of your last merge on this device.">
				<Select<MergeMethodChoice> items={MERGE_METHOD_CHOICES} value={choice} onValueChange={next => next && setChoice(next)}>
					<SelectTrigger aria-label="Default merge method">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(["last", ...MERGE_METHODS] as const).map(value => (
							<SelectItem key={value} value={value}>
								{MERGE_METHOD_CHOICES[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Section>
		</>
	);
}
