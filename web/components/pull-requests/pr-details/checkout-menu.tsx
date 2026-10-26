import { ChevronDown, FolderGit2, GitBranch, type LucideIcon } from "lucide-react";
import type { CheckedOutPullRequest, CheckoutPlace, PullRequest, PullRequestCheckout } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../../activity";
import { putJson } from "../../../api";
import { readPinnedSkill } from "../../../pinned-skill";
import { useAction } from "../../../use-action";
import { toasts } from "../../toaster";
import type { DetailContentProps } from ".";

const PLACES: { place: CheckoutPlace; icon: LucideIcon; label: string; description: string }[] = [
	{ place: "worktree", icon: GitBranch, label: "In a separate worktree", description: "Its own folder and thread. Nothing you have open moves." },
	{ place: "here", icon: FolderGit2, label: "In this repository", description: "Switches the branch you are working in, like `gh pr checkout`." },
];

const CHECKED_OUT: Record<CheckoutPlace, { title: string; description: string }> = {
	worktree: { title: "Checked out", description: "The pull request is in its own worktree, with a session open on it." },
	here: { title: "Checked out here", description: "This repository is on the pull request's branch." },
};

const OFF_HEAD = {
	title: "Checked out, but not confirmed on the latest commit",
	description: "This checkout could not be confirmed at the pull request's latest commit, so its code may differ. Local commits or uncommitted work keep a checkout where it is.",
};

/**
 * **Check out**: the pull request's branch in a worktree of its own with a new session on it, which opens, or in `cwd`,
 * the checkout of its repository the page knows. Both need `cwd`, so with none each item says why it is off.
 */
export function CheckoutMenu({ pr, cwd, onOpen }: { pr: PullRequest; cwd: string | null; onOpen: DetailContentProps["onOpen"] }) {
	const checkOut = useAction(async (place: CheckoutPlace) => {
		if (cwd === null) return;
		const checkout: PullRequestCheckout = { owner: pr.owner, repo: pr.repo, number: pr.number, cwd, place, skill: place === "worktree" ? readPinnedSkill() : null };
		const done = await putJson<CheckedOutPullRequest>("/api/pull-request/checkout", checkout);
		toasts.add(done.onHead ? CHECKED_OUT[place] : OFF_HEAD);
		if (done.place === "worktree") onOpen({ kind: "live", instanceId: done.instanceId, agentId: null }, "replace");
	}, "Could not check out the pull request");
	const label = checkOut.pending ? "Checking out…" : "Check out";
	return (
		<DropdownMenu>
			<Tooltip content="Check out this pull request">
				<DropdownMenuTrigger
					{...activityControl("pr-details.checkout")}
					render={<Button size="xs" variant="outline" className="shrink-0 @max-[35rem]/pr-header:gap-0.5 [&_svg:last-child]:text-muted-foreground" leadingIcon={GitBranch} trailingIcon={ChevronDown} disabled={checkOut.pending} aria-label={label} />}
				>
					<span className="@max-[35rem]/pr-header:hidden">{label}</span>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" side="bottom" className="w-72">
				{PLACES.map(({ place, icon: Icon, label: itemLabel, description }) => (
					<MenuItem key={place} disabled={cwd === null} onClick={() => checkOut.run(place)}>
						<Icon aria-hidden className="mt-1 size-3.5 shrink-0 self-start" />
						<span className="flex min-w-0 flex-col">
							<span>{itemLabel}</span>
							<span className="text-xs text-muted-foreground">{cwd === null ? `No local checkout of ${pr.owner}/${pr.repo} is known.` : description}</span>
						</span>
					</MenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
