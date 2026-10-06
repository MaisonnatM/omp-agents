import { Circle, CircleCheck } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TodoCheckProps {
	done: boolean;
	/** The todo's title, which names the checkbox. */
	label: string;
	/** Changes would not reach the server, or the todo is archived. */
	disabled: boolean;
	onToggle: () => void;
}

/** A todo's checkbox. */
export function TodoCheck({ done, label, disabled, onToggle }: TodoCheckProps) {
	return (
		<Tooltip content={done ? "Mark not done" : "Mark done"} disabled={disabled}>
			<button
				type="button"
				role="checkbox"
				aria-checked={done}
				aria-label={label}
				disabled={disabled}
				onClick={onToggle}
				className={cn("mt-0.5 shrink-0 text-muted-foreground disabled:pointer-events-none [&>svg]:size-4", !disabled && "hover:text-foreground")}
			>
				{done ? <CircleCheck /> : <Circle />}
			</button>
		</Tooltip>
	);
}
