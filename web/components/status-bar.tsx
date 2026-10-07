import { ArrowDown, ArrowUp, FileDiff, GitBranch, GitBranchPlus } from "lucide-react";
import { useEffect, useState } from "react";
import type { BranchChoice, GitStatus, StatusKind } from "../../src/shared/git";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText, putJson } from "../api";
import type { DashboardState } from "../dashboard-state";
import { useRead } from "../reads";
import { hashForChanges } from "../routing";
import { CheckoutVersion, useCheckoutVersion, useGitCheckout } from "../use-git-checkout";
import { CommandPicker, type PickerGroup } from "./command-picker";
import { BranchLabel } from "./git";
import { PlanUsageList } from "./plan-usage";

/** How often the status bar reads the checkout again, for changes made outside the dashboard. */
const POLL_MS = 5000;
/** The most files the changes tooltip names. */
const LISTED = 12;

const LETTER: Record<StatusKind, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!" };

/** The checkout the focused pane's session works in. */
export interface StatusCheckout {
	/** Its worktree, else its directory. */
	dir: string;
	/** The session the Changes page opens on. */
	sessionId: string;
	/** Its turn runs; a turn's end reads the checkout again. */
	working: boolean;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The uncommitted files, linked to the session's Changes page, with the first of them on hover. */
function ChangedFiles({ files, sessionId }: { files: GitStatus["files"]; sessionId: string }) {
	const label = files.length === 0 ? "No uncommitted changes" : plural(files.length, "uncommitted file");
	const content = (
		<div className="flex flex-col gap-0.5">
			<span>{label}</span>
			{files.slice(0, LISTED).map(file => (
				<span key={file.path} className="font-mono">
					<span className="text-muted-foreground">{LETTER[file.kind]}</span> {file.path}
				</span>
			))}
			{files.length > LISTED && <span className="text-muted-foreground">and {files.length - LISTED} more</span>}
		</div>
	);
	return (
		<Tooltip content={content} side="top">
			<a
				href={hashForChanges(sessionId)}
				aria-label={`${label}: open the session's changes`}
				className="flex items-center gap-1 rounded-sm px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
			>
				<FileDiff aria-hidden className="size-3.5" />
				<span className="tabular-nums">{files.length}</span>
			</a>
		</Tooltip>
	);
}

/** Commits ahead of and behind the upstream, as an editor's status bar shows them. */
function UpstreamCounts({ upstream }: { upstream: NonNullable<GitStatus["upstream"]> }) {
	const label = `${plural(upstream.ahead, "commit")} ahead of ${upstream.name}, ${upstream.behind} behind`;
	return (
		<Tooltip content={label} side="top">
			<span tabIndex={0} aria-label={label} className="flex items-center gap-1.5 rounded-sm px-1 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<span className="flex items-center">
					<ArrowUp aria-hidden className="size-3" />
					{upstream.ahead}
				</span>
				<span className="flex items-center">
					<ArrowDown aria-hidden className="size-3" />
					{upstream.behind}
				</span>
			</span>
		</Tooltip>
	);
}

/** Switches the checkout to another local branch, or a new one from the current branch. */
function BranchSwitcher({ dir, branch, onSwitch }: { dir: string; branch: string | null; onSwitch: (choice: BranchChoice) => void }) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const checkout = useGitCheckout(open ? dir : null);
	const name = search.trim();
	const base = checkout?.branch ?? null;
	const label = branch ?? "Detached HEAD";
	const groups: PickerGroup[] = checkout
		? [
				{
					key: "branches",
					heading: "Switch to",
					// git refuses a branch that another worktree has checked out.
					items: checkout.branches
						.filter(other => other.worktree === null || other.name === checkout.branch)
						.map(other => ({
							value: other.name,
							label: <BranchLabel name={other.name} title />,
							selected: other.name === checkout.branch,
							onSelect: () => {
								if (other.name !== checkout.branch) onSwitch({ kind: "existing", name: other.name });
							},
						})),
				},
				...(name !== "" && base !== null && !checkout.branches.some(other => other.name === name)
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
										onSelect: () => onSwitch({ kind: "new", name, base }),
									},
								],
							},
						]
					: []),
			]
		: [];
	return (
		<CommandPicker
			trigger={<BranchLabel name={label} className="max-w-64" />}
			icon={GitBranch}
			ariaLabel={`Branch: ${label}`}
			tooltip={`Branch: ${label}. Choose another to switch this checkout, carrying its uncommitted changes.`}
			search={{ label: "Search or create a branch", query: { value: search, onChange: setSearch } }}
			width="lg"
			side="top"
			className="h-5 px-1.5 text-xs"
			open={open}
			onOpenChange={next => {
				setOpen(next);
				if (!next) setSearch("");
			}}
			list={checkout ? { kind: "ready", groups } : { kind: "loading", message: "Listing branches…" }}
			empty="No branch matches."
		/>
	);
}

/** The focused session's checkout: its branch, which switches, its upstream counts, and its uncommitted files. */
function CheckoutStatus({ dir, sessionId, working, onSwitched }: StatusCheckout & { onSwitched: () => void }) {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => {
			if (!document.hidden) setTick(count => count + 1);
		}, POLL_MS);
		return () => clearInterval(timer);
	}, []);
	const version = useCheckoutVersion(`${tick}:${working}`);
	const status = useRead<GitStatus | null>(`/api/git/status?cwd=${encodeURIComponent(dir)}`, version).data;
	const [failure, setFailure] = useState<string | null>(null);
	if (!status) return null;
	const switchTo = (choice: BranchChoice): void => {
		setFailure(null);
		putJson<GitStatus | null>("/api/git/switch", { cwd: dir, choice }).then(onSwitched, (err: unknown) => setFailure(errorText(err)));
	};
	return (
		<div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 text-muted-foreground">
			{failure !== null && (
				<Tooltip content={failure} side="top">
					<span role="alert" tabIndex={0} className="max-w-80 truncate rounded-sm text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-red-400">
						Cannot switch: {failure}
					</span>
				</Tooltip>
			)}
			<BranchSwitcher dir={dir} branch={status.branch} onSwitch={switchTo} />
			{status.upstream && <UpstreamCounts upstream={status.upstream} />}
			<ChangedFiles files={status.files} sessionId={sessionId} />
		</div>
	);
}

/** The window's bottom strip: plan quota on the left, the focused session's checkout on the right. */
export function StatusBar({ usage, checkout, onSwitched }: { usage: DashboardState["usage"]; checkout: StatusCheckout | null; onSwitched: () => void }) {
	return (
		<footer className="flex min-h-7 shrink-0 items-center gap-4 border-t border-border px-3 py-1 text-xs">
			<PlanUsageList usage={usage} />
			{checkout && <CheckoutStatus key={checkout.dir} {...checkout} onSwitched={onSwitched} />}
		</footer>
	);
}
