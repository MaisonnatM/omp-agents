import { File, Folder, Slash, Sparkles } from "lucide-react";
import type { CompletionItem } from "../../src/shared";

const ICON = { command: Slash, skill: Sparkles, file: File, directory: Folder };

export function CompletionPopup({ id, items, active, onPick, error }: {
	id: string;
	items: CompletionItem[];
	active: number;
	onPick: (item: CompletionItem) => void;
	error: string | null;
}) {
	return (
		<div className="absolute inset-x-6 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl" aria-label="Completions">
		<div id={id} role="listbox" aria-label="Suggestions" className="max-h-64 overflow-y-auto p-1">
			{items.map((item, index) => {
				const Icon = ICON[item.kind];
				return (
					<div
						key={`${item.kind}:${item.label}:${index}`}
						id={`${id}-${index}`}
						role="option"
						aria-selected={index === active}
						className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
						onMouseDown={event => event.preventDefault()}
						onClick={() => onPick(item)}
					>
						<Icon size={16} aria-hidden="true" />
						<span className="min-w-0 flex-1 truncate">{item.label}</span>
						{item.description && <span className="max-w-[45%] truncate text-xs opacity-70">{item.description}</span>}
						</div>
				);
			})}
			{!items.length && <p className="px-3 py-2 text-xs text-muted-foreground">{error ?? "No matches"}</p>}
		</div>
		<p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">↑ ↓ navigate · Tab or Enter insert · Esc close</p>
		</div>
	);
}
