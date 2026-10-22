import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCopy } from "../use-copy";
import { useAction } from "../use-action";

export function CopyableCode({ value, label, className, onCopy }: { value: string; label: string; className?: string; onCopy?: () => void }) {
	const { copied, copy } = useCopy();
	const action = useAction(async () => { await copy(value); onCopy?.(); }, "Could not copy");
	return (
		<Tooltip content={`${copied ? "Copied" : label}: ${value}`} side="bottom">
			<button type="button" aria-label={copied ? `${label}, copied` : label} onClick={() => action.run()} className={cn("relative grid w-fit min-w-0 max-w-full shrink cursor-pointer rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-accent/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}>
				<code className={cn("col-start-1 row-start-1 min-w-0 truncate transition-opacity duration-150 motion-reduce:transition-none", copied ? "opacity-0" : "opacity-100")}>{value}</code>
				<span aria-hidden className={cn("col-start-1 row-start-1 truncate text-center transition-opacity duration-150 motion-reduce:transition-none", copied ? "opacity-100" : "opacity-0")}>Copied</span>
			</button>
		</Tooltip>
	);
}
