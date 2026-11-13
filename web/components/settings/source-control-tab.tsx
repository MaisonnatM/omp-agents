import { IconArrowRotateClockwise } from "central-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
	type GithubStatus,
	MERGE_METHOD_LABELS,
	MERGE_METHODS,
	type MergeMethodChoice,
	type PullOutcome,
	type PullRepo,
	type SourceControlAnswer,
	type SourceControlChange,
} from "../../../src/shared/source-control";
import { putJson } from "../../api";
import { useEditableRead } from "../../editable-read";
import { age, folderName } from "../../labels";
import { useMergeMethodChoice } from "../../merge-method";
import { useAction } from "../../use-action";
import { IntegrationList } from "../integrations/integration-row";
import { OrgIcon } from "../org-icon";
import { Section } from "./editor";
import { ToggleSwitch } from "../toggle-switch";

const GITHUB_FACTS: Record<Exclude<GithubStatus["state"], "signed-in">, string> = { missing: "gh is not installed", "signed-out": "Run gh auth login in a terminal to sign in" };

function GithubRow({ status }: { status: GithubStatus }) {
	const fact = status.state === "signed-in" ? (status.account ? `Signed in as ${status.account}` : "gh is signed in") : GITHUB_FACTS[status.state];
	return (
		<li className="flex items-start gap-3.5 p-4">
			<span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-5 shadow-surface-2">
				<OrgIcon org="github" className="size-5" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<h3 className="text-[13px] font-medium">GitHub</h3>
					{status.state === "signed-in" && (
						<Badge variant="dot" size="compact" color="green">
							Connected
						</Badge>
					)}
				</div>
				<p className="mt-0.5 text-[13px] text-pretty text-muted-foreground">Reads your pull requests, changes them, and merges them through the gh CLI.</p>
				<p className="mt-1.5 text-xs text-muted-foreground">{fact}</p>
			</div>
		</li>
	);
}

const SKIPPED: Record<Extract<PullOutcome, { kind: "skipped" }>["reason"], string> = { changes: "Skipped: local changes", commits: "Skipped: local commits", held: "Skipped: update undone", "no-default-branch": "Skipped: no default branch", failed: "Failed" };

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

/** The GitHub CLI, automatic pulls by default and per repository, the cleanup after a merge, and the merge button's starting method. */
export function SourceControlTab({ active }: { active: boolean }) {
	const read = useEditableRead<SourceControlAnswer>(active ? "/api/source-control" : null);
	const write = useAction(async (next: SourceControlChange) => {
		await read.write(() => putJson<SourceControlAnswer>("/api/source-control", next));
	}, null);
	const pending = write.pending;
	const error = write.error;
	const [choice, setChoice] = useMergeMethodChoice();
	const change = write.run;
	const answer = read.data;
	const on = answer?.autoPull.on ?? false;
	return (
		<>
			<Section
				title="Command-line tools"
				meta="The command-line tool the dashboard and your sessions reach GitHub through."
				actions={
					<Button variant="ghost" size="compact" leadingIcon={IconArrowRotateClockwise} onClick={read.reload}>
						Check again
					</Button>
				}
			>
				{read.error && <p className="text-xs text-red-600 dark:text-red-400">{read.error}</p>}
				{answer && (
					<IntegrationList label="Command-line tools">
						<GithubRow status={answer.github} />
					</IntegrationList>
				)}
			</Section>
			<Section title="Automatically pull" meta="Keeps the default branch current when the checkout has no local changes or commits. Projects can override it.">
				<p className="text-xs text-muted-foreground">Each repository your workspaces use is a project; its own choice wins over the default.</p>
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
					<ToggleSwitch aria-label="Automatically pull" checked={on} disabled={!answer || pending} onCheckedChange={next => change({ op: "default", on: next })} />
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
									onValueChange={next => next && change({ op: "repo", repo: repo.path, on: next === "default" ? null : next === "on" })}
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
					<ToggleSwitch aria-label="Clean up after a merge" checked={answer?.cleanUp ?? true} disabled={!answer || pending} onCheckedChange={next => change({ op: "clean-up", on: next })} />
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
