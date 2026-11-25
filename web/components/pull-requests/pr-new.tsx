/**
 * The Pull requests page's **New pull request** button: a popover that picks a workspace of a repository and starts an
 * omp session there on what should change, which makes the change on a new branch and opens a pull request for it.
 */
import { IconPlusSmall } from "central-icons";
import { useEffect, useId, useRef, useState } from "react";
import { type Repo, repoKey, type RepoPullRequests, repoName } from "../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";
import { folderName } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { chordLabel } from "../../shortcuts";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { isSubmitChord } from "../form-dialog";
import { Field, TEXT_AREA } from "../form-field";

/** A workspace the new pull request can start in: `value` is its directory, `label` its repository, with the folder when the repository has several. */
type WorkspaceChoice = { value: string; label: string; repo: Repo };

/** The **New pull request** button, whose popover starts a session in a workspace of `everyRepo` on the change you describe. */
export function NewPullRequestButton({ everyRepo }: { everyRepo: RepoPullRequests[] }) {
	const { start, dismissStart } = useDashboardActions();
	const { connected, starts } = useDashboardStatus();
	const lastStart = starts.pullRequestNew;
	const [open, setOpen] = useState(false);
	const [picked, setPicked] = useState<string | null>(null);
	const [change, setChange] = useState("");
	// This popover sent the start under way, so its success clears the text and closes it.
	const [sent, setSent] = useState(false);
	const changeId = useId();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const choices = everyRepo.flatMap((repo): WorkspaceChoice[] =>
		repo.cwds.map(cwd => ({ value: cwd, label: repo.cwds.length > 1 ? `${repoName(repo)} · ${folderName(cwd) ?? cwd}` : repoName(repo), repo })),
	);
	// The picked workspace until it leaves the list, then the first.
	const choice = choices.find(({ value }) => value === picked) ?? choices[0];
	const starting = lastStart?.phase === "starting";
	const blocked =
		choice === undefined
			? "Add a workspace of a repository first"
			: !connected
				? "Waiting for the server to reconnect"
				: change.trim() === ""
					? "Describe the change first"
					: starting
						? "Starting the session"
						: null;
	const ready = blocked === null;
	const error = lastStart?.phase === "failed" ? lastStart.error : null;

	useEffect(() => {
		if (!sent || lastStart?.phase === "starting") return;
		setSent(false);
		if (lastStart !== null) return;
		setChange("");
		setOpen(false);
	}, [sent, lastStart]);

	const launch = (): void => {
		if (!ready || choice === undefined) return;
		start({ kind: "pull-request-new", cwd: choice.value, repo: repoName(choice.repo), change: change.trim(), skill: readPinnedSkill() });
		setSent(true);
	};

	const changeOpen = (next: boolean): void => {
		setOpen(next);
		if (!next && lastStart?.phase === "failed") dismissStart("pull-request-new");
	};

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<Tooltip content="New pull request" forceOpen={open ? false : undefined}>
				<PopoverTrigger
					render={
						<Button {...activityControl("pull-requests.new")} variant="ghost" size="icon-compact" aria-label="New pull request" active={open}>
							<IconPlusSmall />
						</Button>
					}
				/>
			</Tooltip>
			<PopoverContent align="end" collisionPadding={8} className="w-96 max-w-[calc(100vw-2rem)] space-y-3 p-3" initialFocus={() => textareaRef.current}>
				<PopoverHeader>
					<PopoverTitle className="text-sm">
						New pull request
					</PopoverTitle>
				</PopoverHeader>
				<form
					className="space-y-3"
					onSubmit={event => {
						event.preventDefault();
						launch();
					}}
				>
					{choice && (
						<Select items={choices} value={choice.value} onValueChange={next => next && setPicked(next)}>
							<SelectTrigger aria-label="Workspace" className="w-full min-w-0 [&>span]:truncate">
								<SelectValue />
							</SelectTrigger>
							<SelectContent alignItemWithTrigger={false}>
								{choices.map(({ value, label, repo }) => (
									<SelectItem key={`${repoKey(repo)} ${value}`} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<Field label="What should change?" htmlFor={changeId}>
						<textarea
							id={changeId}
							ref={textareaRef}
							value={change}
							rows={4}
							onChange={event => setChange(event.target.value)}
							onKeyDown={event => {
								if (!isSubmitChord(event)) return;
								event.preventDefault();
								launch();
							}}
							className={`${TEXT_AREA} resize-none`}
						/>
					</Field>
					{error !== null && (
						<p role="alert" className="text-xs text-red-600 dark:text-red-400">
							{error}
						</p>
					)}
					<div className="flex justify-end">
						<Tooltip content={blocked ?? "Start a session that opens the pull request"} shortcut={blocked ? undefined : [chordLabel({ key: "Enter", mod: true })]} side="top">
							{/* A disabled button takes no pointer events, so the tooltip that says why sits on a wrapper. */}
							<span className="inline-flex">
								<Button {...activityControl("pull-requests.new.start")} type="submit" size="compact" disabled={!ready}>
									Start
								</Button>
							</span>
						</Tooltip>
					</div>
				</form>
			</PopoverContent>
		</Popover>
	);
}
