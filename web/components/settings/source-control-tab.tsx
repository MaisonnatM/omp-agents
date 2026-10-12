import { Switch } from "@base-ui/react/switch";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
	type AutoPullChange,
	MERGE_METHOD_LABELS,
	MERGE_METHODS,
	type MergeMethodChoice,
	type ProviderStatus,
	type PullOutcome,
	type PullRepo,
	type SourceControlAnswer,
	type SourceControlProvider,
} from "../../../src/shared/source-control";
import { errorText, putJson } from "../../api";
import { age, folderName } from "../../labels";
import { useMergeMethodChoice } from "../../merge-method";
import { useReplaceableRead } from "../../reads";
import { IntegrationList } from "../integrations/integration-row";
import { OrgIcon } from "../org-icon";
import { Section } from "./editor";

const PROVIDERS: Record<SourceControlProvider, { name: string; summary: string; signIn: string }> = {
	github: { name: "GitHub", summary: "Reads your pull requests, changes them, and merges them through the gh CLI.", signIn: "gh auth login" },
	graphite: { name: "Graphite", summary: "Opens your pull requests on Graphite, and lets sessions submit stacks with the gt CLI.", signIn: "gt auth --token <token>" },
};

function ProviderRow({ status }: { status: ProviderStatus }) {
	const { name, summary, signIn } = PROVIDERS[status.provider];
	const cli = status.provider === "github" ? "gh" : "gt";
	const fact = { missing: `${cli} is not installed`, "signed-out": `Run ${signIn} in a terminal to sign in`, "signed-in": status.account ? `Signed in as ${status.account}` : `${cli} is signed in` }[status.state];
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

function AutoPullSwitch(props: { checked: boolean; disabled: boolean; label: string; onCheckedChange: (on: boolean) => void }) {
	return (
		<Switch.Root
			aria-label={props.label}
			checked={props.checked}
			disabled={props.disabled}
			onCheckedChange={props.onCheckedChange}
			className="inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 motion-reduce:transition-none"
		>
			<Switch.Thumb className="size-3 rounded-full bg-background shadow-xs transition-transform data-[checked]:translate-x-3 motion-reduce:transition-none" />
		</Switch.Root>
	);
}

/** GitHub's and Graphite's CLIs, automatic pulls by default and per repository, and the merge button's starting method. */
export function SourceControlTab({ active }: { active: boolean }) {
	const [reads, setReads] = useState(0);
	const read = useReplaceableRead<SourceControlAnswer>(active ? "/api/source-control" : null, reads);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [choice, setChoice] = useMergeMethodChoice();
	const change = async (next: AutoPullChange): Promise<void> => {
		setPending(true);
		setError(null);
		try {
			read.replace(await putJson<SourceControlAnswer>("/api/source-control", next));
		} catch (err) {
			setError(errorText(err));
		} finally {
			setPending(false);
		}
	};
	const answer = read.data;
	const on = answer?.autoPull.on ?? false;
	return (
		<>
			<Section
				title="Providers"
				meta="The command-line tools the dashboard and your sessions reach GitHub and Graphite through."
				actions={
					<Button variant="ghost" size="compact" leadingIcon={RefreshCw} onClick={() => setReads(count => count + 1)}>
						Check again
					</Button>
				}
			>
				{read.error && <p className="text-xs text-red-600 dark:text-red-400">{read.error}</p>}
				{answer && (
					<IntegrationList label="Source control providers">
						{answer.providers.map(status => (
							<ProviderRow key={status.provider} status={status} />
						))}
					</IntegrationList>
				)}
			</Section>
			<Section title="Automatically pull" meta="Keeps the default branch current when the checkout has no local changes or commits. Projects can override it.">
				<p className="text-xs text-muted-foreground">Each repository your workspaces use is a project; its own choice wins over the default.</p>
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
					<AutoPullSwitch label="Automatically pull" checked={on} disabled={!answer || pending} onCheckedChange={next => void change({ op: "default", on: next })} />
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
										{repo.path} · {lastPull(repo)}
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
			<Section title="Default merge method" meta="Pull requests start with this method. Last selected reuses whatever you chose most recently on this device.">
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
