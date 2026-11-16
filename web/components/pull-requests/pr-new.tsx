/**
 * The Pull requests page's **New pull request** button: a popover that picks a workspace of a repository and starts an
 * omp session there on what should change, which makes the change on a new branch and opens a pull request for it.
 */
import { IconPlusLarge } from "central-icons";
import { useId, useRef, useState } from "react";
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
	const { start } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [open, setOpen] = useState(false);
	const [picked, setPicked] = useState<string | null>(null);
	const [change, setChange] = useState("");
	const titleId = useId();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const choices = everyRepo.flatMap((repo): WorkspaceChoice[] =>
		repo.cwds.map(cwd => ({ value: cwd, label: repo.cwds.length > 1 ? `${repoName(repo)} · ${folderName(cwd) ?? cwd}` : repoName(repo), repo })),
	);
	// The picked workspace until it leaves the list, then the first.
	const choice = choices.find(({ value }) => value === picked) ?? choices[0];
	const ready = choice !== undefined && change.trim() !== "" && connected;
	const blocked = !connected ? "Waiting for the server to reconnect" : change.trim() === "" ? "Describe the change first" : null;
	const changeId = useId();

	const launch = (): void => {
		if (!ready) return;
		start({
			kind: "new",
			cwd: choice.value,
			prompt: `Make this change in ${repoName(choice.repo)} on a new branch, then open a pull request for it.\n\n${change.trim()}`,
			images: [],
			branch: null,
			model: null,
			thinking: null,
			skill: readPinnedSkill(),
			todoId: null,
			private: false,
			fromDraft: false,
		});
		setChange("");
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content="New pull request" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button {...activityControl("pull-requests.new")} variant="ghost" size="icon-compact" aria-label="New pull request" data-state={open ? "open" : "closed"} active={open}>
						<IconPlusLarge />
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent
				align="end"
				collisionPadding={8}
				aria-labelledby={titleId}
				className="w-96 max-w-[calc(100vw-2rem)] space-y-3 p-3"
				onOpenAutoFocus={event => {
					event.preventDefault();
					textareaRef.current?.focus();
				}}
			>
				<PopoverHeader>
					<PopoverTitle id={titleId} className="text-sm">
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
