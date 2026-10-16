/** The confirmation before a pull request merges on GitHub, which the details' merge button and a row's **Merge** badge open. */
import { GitMerge } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { type PullRequest, type PullRequestDetail, pullRequestName } from "../../../src/shared/github";
import { MERGE_METHOD_LABELS, type MergeMethod, startingMethod } from "../../../src/shared/source-control";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { useLastMergeMethod, useMergeMethodChoice } from "../../merge-method";

export interface MergePopoverProps {
	pr: PullRequest;
	/** What the merge needs from GitHub; `null` while it is read. */
	target: Pick<PullRequestDetail, "base" | "headOid" | "mergeMethods"> | null;
	/** Why `target` could not be read, if it could not. */
	error?: string | null;
	/** Merges with `method`, only while the branch's head is still `head`. */
	onMerge: (method: MergeMethod, head: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The trigger's tooltip, if any. */
	tooltip?: string;
	/** Which edge of the trigger the confirmation lines up with: the header's button sits at the right, a row's badge at the left. */
	align?: "start" | "end";
	/** The trigger, given the method the merge starts with. */
	children: (method: MergeMethod | null) => ReactElement;
}

/** Merges on GitHub with the method Settings starts it on, after a confirmation that can switch the method. */
export function MergePopover({ pr, target, error = null, onMerge, open, onOpenChange, tooltip, align = "end", children }: MergePopoverProps) {
	const [choice] = useMergeMethodChoice();
	const [last, setLast] = useLastMergeMethod();
	const [picked, setPicked] = useState<MergeMethod | null>(null);
	const allowed = target?.mergeMethods ?? [];
	const method = picked && allowed.includes(picked) ? picked : startingMethod(choice, last, allowed);
	const merge = (): void => {
		if (!target || !method) return;
		setLast(method);
		onOpenChange(false);
		onMerge(method, target.headOid);
	};
	const trigger = <PopoverTrigger asChild>{children(method)}</PopoverTrigger>;
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			{tooltip ? (
				<Tooltip content={tooltip} forceOpen={open ? false : undefined}>
					{trigger}
				</Tooltip>
			) : (
				trigger
			)}
			<PopoverContent align={align} className="w-72 space-y-3 p-3">
				{target === null ? (
					<p role={error ? "alert" : undefined} className="text-[13px] text-muted-foreground">
						{error ?? "Reading the pull request…"}
					</p>
				) : (
					<p className="text-[13px] text-pretty">
						Merge {pullRequestName(pr)} into <span className="font-mono">{target.base}</span> on GitHub?
					</p>
				)}
				{target && allowed.length === 0 && <p className="text-[13px] text-muted-foreground">The repository allows no merge method.</p>}
				{allowed.length > 1 && method && (
					<RadioGroup aria-label="Merge method" value={method} onValueChange={value => setPicked(allowed.find(candidate => candidate === value) ?? null)} className="space-y-1">
						{allowed.map(candidate => (
							<label key={candidate} className="flex cursor-pointer items-center gap-2 text-[13px]">
								<Radio.Root value={candidate} className="flex size-3.5 items-center justify-center rounded-full shadow-[0_0_0_1px_var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary">
									<Radio.Indicator className="size-1.5 rounded-full bg-background" />
								</Radio.Root>
								{MERGE_METHOD_LABELS[candidate]}
							</label>
						))}
					</RadioGroup>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="compact" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" size="compact" leadingIcon={GitMerge} disabled={method === null} onClick={merge}>
						{method ? MERGE_METHOD_LABELS[method] : "Merge"}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
