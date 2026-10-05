import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { shortcutLabels } from "../shortcuts";

export interface ThinkingChoicesProps {
	current: string | null;
	levels: string[] | null;
	onPick: (level: string | null) => void;
	allowDefault?: boolean;
	pending?: boolean;
	disabled?: boolean;
}

export function ThinkingChoices({ current, levels, onPick, allowDefault, pending, disabled }: ThinkingChoicesProps) {
	return (
		<fieldset disabled={disabled || pending} className="min-w-0 border-t border-border p-3">
			<legend className="sr-only">Thinking level</legend>
			<Tooltip content="Thinking level" shortcut={shortcutLabels("thinking")}>
				<span className="mb-2 flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
					<Brain aria-hidden="true" className="size-3.5" />
					Thinking level
				</span>
			</Tooltip>
			{pending ? (
				<p role="status" className="text-xs text-muted-foreground">Switching model…</p>
			) : levels === null ? (
				<p role="status" className="text-xs text-muted-foreground">Thinking levels are unavailable until a model and its capabilities are loaded.</p>
			) : (
				<>
					<div className="flex flex-wrap gap-1">
						{allowDefault && (
							<Button variant="ghost" size="compact" aria-label="Thinking level: Default" aria-pressed={current === null} active={current === null} onClick={() => onPick(null)}>
								Default
							</Button>
						)}
						{levels.map(level => (
							<Button key={level} variant="ghost" size="compact" aria-label={`Thinking level: ${level}`} aria-pressed={current === level} active={current === level} onClick={() => onPick(level)}>
								{level}
							</Button>
						))}
					</div>
					{levels.length === 0 && <p className="mt-2 text-xs text-muted-foreground">This model has no selectable thinking levels.</p>}
				</>
			)}
		</fieldset>
	);
}
