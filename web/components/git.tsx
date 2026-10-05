import { GitBranch, GitBranchPlus } from "lucide-react";
import { Fragment, useState } from "react";
import { type BranchChoice, type GitCheckout, worktreeDir } from "../../src/shared";
import { projectName } from "../labels";
import { CommandPicker } from "./command-picker";
import { OrgIcon } from "./org-icon";

/** The GitHub repository, linked, then the branch, for a header's meta line; nothing outside a git checkout. */
export function GitRef({ github, branch }: { github: GitCheckout["github"]; branch: string | null }) {
	const parts = [
		github && (
			<a
				key="repo"
				href={`https://github.com/${github.owner}/${github.repo}`}
				target="_blank"
				rel="noreferrer"
				title={`${github.owner}/${github.repo} on GitHub`}
				className="underline-offset-2 hover:text-foreground hover:underline"
			>
				<OrgIcon org="github" className="mr-1 inline align-[-0.125em]" />
				{github.owner}/{github.repo}
			</a>
		),
		branch && (
			<span key="branch" title={`Branch ${branch}`}>
				<GitBranch aria-hidden className="mr-0.5 inline size-3 align-[-0.125em]" />
				{branch}
			</span>
		),
	].filter(Boolean);
	return parts.map((part, index) => (
		<Fragment key={index}>
			{index > 0 && " · "}
			{part}
		</Fragment>
	));
}

/** The branch a new session works on, as the picker shows it: `null` keeps the directory as it is. */
export const chosenBranch = (checkout: GitCheckout, choice: BranchChoice | null): string | null => choice?.name ?? checkout.branch;

/** The directory a new session on `choice` runs in, and whether starting it adds that worktree. */
export function targetOf(checkout: GitCheckout, cwd: string, choice: BranchChoice | null): { dir: string; creates: boolean } {
	if (choice === null || choice.name === checkout.branch) return { dir: cwd, creates: false };
	const worktree = choice.kind === "existing" ? checkout.branches.find(branch => branch.name === choice.name)?.worktree : null;
	return worktree ? { dir: worktree, creates: false } : { dir: worktreeDir(checkout.mainWorktree, choice.name), creates: true };
}

interface BranchPickerProps {
	checkout: GitCheckout;
	choice: BranchChoice | null;
	onChoose: (choice: BranchChoice | null) => void;
	disabled?: boolean;
}

/**
 * Picks an existing local branch, or names a new one, which branches from the branch picked before it, as GitHub's
 * branch menu does. Picking the branch the directory has checked out keeps the directory as it is.
 */
export function BranchPicker({ checkout, choice, onChoose, disabled = false }: BranchPickerProps) {
	const [search, setSearch] = useState("");
	const current = chosenBranch(checkout, choice);
	const base = choice?.kind === "new" ? choice.base : current;
	const name = search.trim();
	const creatable = name !== "" && base !== null && !checkout.branches.some(branch => branch.name === name);
	const label = current ?? "Detached HEAD";
	return (
		<CommandPicker
			trigger={
				<span className="max-w-64 truncate">
					{label}
					{choice?.kind === "new" && <span className="text-muted-foreground"> from {choice.base}</span>}
				</span>
			}
			icon={choice?.kind === "new" ? GitBranchPlus : GitBranch}
			ariaLabel={`Branch: ${label}${choice?.kind === "new" ? `, new from ${choice.base}` : ""}`}
			disabled={disabled}
			search={{ label: "Search or create a branch", query: { value: search, onChange: setSearch } }}
			width="lg"
			side="top"
			onOpenChange={next => {
				if (!next) setSearch("");
			}}
			list={{
				kind: "ready",
				groups: [
					{
						key: "branches",
						heading: "Branches",
						items: checkout.branches.map(branch => ({
							value: branch.name,
							label: (
								<>
									<span className="truncate">{branch.name}</span>
									<span className="ml-auto shrink-0 text-xs text-muted-foreground" title={branch.worktree ?? undefined}>
										{branch.name === checkout.branch ? "here" : branch.worktree ? projectName(branch.worktree) : "new worktree"}
									</span>
								</>
							),
							selected: branch.name === current && choice?.kind !== "new",
							onSelect: () => onChoose(branch.name === checkout.branch ? null : { kind: "existing", name: branch.name }),
						})),
					},
					...(creatable
						? [
								{
									key: "create",
									forceMount: true,
									items: [
										{
											value: `create ${name}`,
											label: (
												<>
													<GitBranchPlus aria-hidden />
													<span className="truncate">
														Create branch <strong className="font-medium">{name}</strong> from {base}
													</span>
												</>
											),
											onSelect: () => onChoose({ kind: "new", name, base }),
										},
									],
								},
							]
						: []),
				],
			}}
			empty={!creatable && "No branch matches."}
		/>
	);
}
