import { Check, GitBranch, GitBranchPlus } from "lucide-react";
import { Fragment, useState } from "react";
import { type BranchChoice, type GitCheckout, worktreeDir } from "../../src/shared/git";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { projectName } from "../labels";
import { useCopy } from "../use-copy";
import { CommandPicker } from "./command-picker";
import { OrgIcon } from "./org-icon";

/** A branch label that keeps both ends visible when space runs out; `title` shows the full name where no tooltip does. */
export function BranchLabel({ name, title = false, className }: { name: string; title?: boolean; className?: string }) {
	let split = Math.ceil(name.length / 2);
	const before = name.charCodeAt(split - 1);
	if (before >= 0xd800 && before <= 0xdbff) split++;
	return (
		<span title={title ? name : undefined} className={cn("inline-flex min-w-0 max-w-full align-bottom", className)}>
			<span className="min-w-0 truncate">{name.slice(0, split)}</span>
			<span className="flex min-w-0 justify-end overflow-hidden">
				<span className="whitespace-nowrap">{name.slice(split)}</span>
			</span>
		</span>
	);
}

/** A branch name, with its icon, that copies the name when clicked; the icon turns into a check mark once it is copied. */
export function BranchName({ name, className }: { name: string; className?: string }) {
	const { copied, copy } = useCopy();
	const Icon = copied ? Check : GitBranch;
	return (
		<Tooltip content={copied ? "Copied" : `Copy branch ${name}`}>
			<button
				type="button"
				aria-label={`Copy branch ${name}`}
				onClick={() => copy(name)}
				className={cn("inline-flex min-w-0 max-w-64 items-center gap-0.5 rounded-sm text-left underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring", className)}
			>
				<Icon aria-hidden className="size-3 shrink-0" />
				<BranchLabel name={name} />
			</button>
		</Tooltip>
	);
}

/** The GitHub repository, linked, then the branch, for a header's meta line; nothing outside a git checkout. */
export function GitRef({ github, branch }: { github: GitCheckout["github"]; branch: string | null }) {
	const parts = [
		github && (
			<Tooltip key="repo" content={`${github.owner}/${github.repo} on GitHub`}>
				<a
					href={`https://github.com/${github.owner}/${github.repo}`}
					target="_blank"
					rel="noreferrer"
					className="underline-offset-2 hover:text-foreground hover:underline"
				>
					<OrgIcon org="github" className="mr-1 inline align-[-0.125em]" />
					{github.owner}/{github.repo}
				</a>
			</Tooltip>
		),
		branch && <BranchName key="branch" name={branch} />,
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
				<span className="inline-flex min-w-0 max-w-64 items-center gap-1">
					<BranchLabel name={label} />
					{choice?.kind === "new" && (
						<>
							<span className="shrink-0 text-muted-foreground">from</span>
							<BranchLabel name={choice.base} className="text-muted-foreground" />
						</>
					)}
				</span>
			}
			icon={choice?.kind === "new" ? GitBranchPlus : GitBranch}
			ariaLabel={`Branch: ${label}${choice?.kind === "new" ? `, new from ${choice.base}` : ""}`}
			tooltip={`Branch: ${label}${choice?.kind === "new" ? `, new from ${choice.base}` : ""}. Choosing another branch uses its existing worktree or creates a new worktree.`}
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
									<BranchLabel name={branch.name} title />
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
													<span className="flex min-w-0 items-center gap-1">
														<span className="shrink-0">Create branch</span>
														<BranchLabel name={name} title className="font-medium" />
														<span className="shrink-0">from</span>
														<BranchLabel name={base} title />
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
