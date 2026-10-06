import { type ReactNode, useEffect, useState } from "react";
import type { UserTodoChange } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/** How long **Undo** stays after a todo is deleted. */
const UNDO_MS = 8000;

export interface Undo {
	offer: (text: string, change: UserTodoChange) => void;
	toast: ReactNode;
}

/** **Undo** for the last delete: `offer` it with the todo's title and the change that puts it back, and render `toast`. */
export function useUndo(onChange: (change: UserTodoChange) => void): Undo {
	const [undo, setUndo] = useState<{ text: string; change: UserTodoChange } | null>(null);
	useEffect(() => {
		if (!undo) return;
		const timer = setTimeout(() => setUndo(null), UNDO_MS);
		return () => clearTimeout(timer);
	}, [undo]);
	const toast = undo && (
		<div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-lg">
			<span className="max-w-72 truncate">Deleted “{undo.text}”</span>
			<Tooltip content="Put the todo back">
				<Button
					variant="secondary"
					size="compact"
					onClick={() => {
						onChange(undo.change);
						setUndo(null);
					}}
				>
					Undo
				</Button>
			</Tooltip>
		</div>
	);
	return { offer: (text, change) => setUndo({ text, change }), toast };
}
