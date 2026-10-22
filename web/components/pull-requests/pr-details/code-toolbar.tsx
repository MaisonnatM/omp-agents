import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Columns2, FolderTree, type LucideIcon, Pilcrow, Rows3, Settings2, TextWrap } from "lucide-react";
import { useState } from "react";
import type { PullRequestCommit } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSwitchItem } from "@/components/ui/menu";
import type { DiffOptions } from "../../../diff-options";
import type { DiffPreferences } from "./diff-preferences";

const COMMIT_PAGE = 10;

/** The diff options, as icon buttons in a wide toolbar and as the items of its options menu in a narrow one. */
const DIFF_OPTIONS: readonly { label: string; icon: LucideIcon; on: (options: DiffOptions) => boolean; pick: (options: DiffOptions) => Partial<DiffOptions> }[] = [
	{ label: "Hide whitespace changes", icon: Pilcrow, on: options => options.ignoreWhitespace, pick: options => ({ ignoreWhitespace: !options.ignoreWhitespace }) },
	{ label: "Stacked diff view", icon: Rows3, on: options => options.layout === "stacked", pick: () => ({ layout: "stacked" }) },
	{ label: "Split diff view", icon: Columns2, on: options => options.layout === "split", pick: () => ({ layout: "split" }) },
	{ label: "Wrap lines", icon: TextWrap, on: options => options.wrap, pick: options => ({ wrap: !options.wrap }) },
];

interface CodeToolbarProps {
	/** The pull request's commits, oldest first. */
	commits: readonly PullRequestCommit[];
	/** The commit the diffs are scoped to; `null` for all of them. */
	commit: string | null;
	onCommit: (commit: string | null) => void;
	/** How many files show as viewed, of how many; `null` while the files are read. */
	viewed: { count: number; total: number } | null;
	preferences: DiffPreferences;
	allCollapsed: boolean;
	onCollapseAll: () => void;
}

export function CodeToolbar({ commits, commit, onCommit, viewed, preferences, allCollapsed, onCollapseAll }: CodeToolbarProps) {
	const { options, change, treeOpen, toggleTree } = preferences;
	const collapseLabel = allCollapsed ? "Expand all files" : "Collapse all files";
	const treeLabel = treeOpen ? "Hide file tree" : "Show file tree";
	return (
		<div
			aria-label="Code toolbar"
			className="@container/code flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-4 text-xs text-muted-foreground"
		>
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<CommitScope commits={commits} commit={commit} onCommit={onCommit} />
				{viewed && (
					<span className="shrink-0 whitespace-nowrap tabular-nums @max-[28rem]/code:text-2xs">
						{viewed.count} of {viewed.total} viewed
					</span>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<div className="hidden items-center gap-1 @min-[36rem]/code:flex">
					{DIFF_OPTIONS.map(({ label, icon: Icon, on, pick }) => (
						<Button key={label} size="icon-xs" variant="ghost-muted" active={on(options)} title={label} aria-label={label} aria-pressed={on(options)} onClick={() => change(pick(options))}>
							<Icon aria-hidden className="size-3.5" />
						</Button>
					))}
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost-muted" aria-label="Diff options" className="@min-[36rem]/code:hidden" />}>
						<Settings2 aria-hidden className="size-3.5" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{DIFF_OPTIONS.map(({ label, on, pick }) => (
							<MenuSwitchItem key={label} checked={on(options)} onCheckedChange={() => change(pick(options))}>
								{label}
							</MenuSwitchItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				<Button size="icon-xs" variant="ghost-muted" aria-label={collapseLabel} title={collapseLabel} onClick={onCollapseAll}>
					{allCollapsed ? <ChevronsUpDown aria-hidden className="size-3.5" /> : <ChevronsDownUp aria-hidden className="size-3.5" />}
				</Button>
				<Button size="icon-xs" variant="ghost-muted" active={treeOpen} aria-label={treeLabel} title={treeLabel} aria-pressed={treeOpen} onClick={toggleTree}>
					<FolderTree aria-hidden className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}

/** The menu that scopes the diffs to one commit, newest first, a page of commits at a time. */
function CommitScope({ commits, commit, onCommit }: Pick<CodeToolbarProps, "commits" | "commit" | "onCommit">) {
	const [shown, setShown] = useState(COMMIT_PAGE);
	const label = commits.find(entry => entry.oid === commit)?.headline ?? "All commits";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="xs"
						variant="secondary"
						trailingIcon={ChevronDown}
						className="min-w-0 max-w-64 [&>span.relative]:min-w-0 [&>span.relative>span]:min-w-0 [&_svg]:shrink-0"
						aria-label={`Diff scope: ${label}`}
					/>
				}
			>
				<span className="block truncate">{label}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-[min(28rem,calc(100vw-2rem))]">
				<MenuRadioGroup aria-label="Commit scope" value={commit ?? "all"} onValueChange={value => onCommit(value === "all" ? null : value)}>
					<MenuRadioItem value="all" closeOnClick>
						All commits
					</MenuRadioItem>
					{commits
						.toReversed()
						.slice(0, shown)
						.map(entry => (
							<MenuRadioItem key={entry.oid} value={entry.oid} closeOnClick>
								<span className="truncate">{entry.headline}</span>
								<span className="ml-auto font-mono text-2xs">{entry.sha}</span>
							</MenuRadioItem>
						))}
				</MenuRadioGroup>
				{commits.length > shown && (
					<MenuItem closeOnClick={false} onClick={() => setShown(count => count + COMMIT_PAGE)}>
						Show more ({commits.length - shown} left)
					</MenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
