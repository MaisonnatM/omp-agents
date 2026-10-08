import { type Dispatch, type SetStateAction, useEffect, useReducer, useState } from "react";
import { QUICK_TODO_EVENT } from "../src/server/address";
import { paletteReducer, type PaletteEvent, type PaletteState } from "./command-palette";

/** The dialogs and the command palette that float over every page. */
export interface Overlays {
	shortcutsOpen: boolean;
	setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
	palette: PaletteState | null;
	dispatchPalette: Dispatch<PaletteEvent>;
	/** The path the file dialog shows, `null` while it is closed. */
	filePath: string | null;
	setFilePath: Dispatch<SetStateAction<string | null>>;
	/** The title the new-ticket dialog starts from while it is open. */
	newTicket: string | null;
	setNewTicket: Dispatch<SetStateAction<string | null>>;
}

/** What is open over the page. The desktop shell's quick-capture shortcut opens the command palette on Create todo. */
export function useOverlays(): Overlays {
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [palette, dispatchPalette] = useReducer(paletteReducer, null);
	const [filePath, setFilePath] = useState<string | null>(null);
	const [newTicket, setNewTicket] = useState<string | null>(null);
	useEffect(() => {
		const open = (): void => dispatchPalette({ type: "open", view: "createTodo" });
		window.addEventListener(QUICK_TODO_EVENT, open);
		return () => window.removeEventListener(QUICK_TODO_EVENT, open);
	}, []);
	return { shortcutsOpen, setShortcutsOpen, palette, dispatchPalette, filePath, setFilePath, newTicket, setNewTicket };
}
