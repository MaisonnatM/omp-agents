import { type Dispatch, type SetStateAction, useReducer, useState } from "react";
import { paletteReducer, type PaletteEvent, type PaletteState } from "./command-palette";
import type { FileTarget } from "./file-paths";

/** The dialogs and the command palette that float over every page. */
export interface Overlays {
	palette: PaletteState | null;
	dispatchPalette: Dispatch<PaletteEvent>;
	/** The file the file dialog shows, `null` while it is closed. */
	openedFile: FileTarget | null;
	setOpenedFile: Dispatch<SetStateAction<FileTarget | null>>;
}

/** What is open over the page. */
export function useOverlays(): Overlays {
	const [palette, dispatchPalette] = useReducer(paletteReducer, null);
	const [openedFile, setOpenedFile] = useState<FileTarget | null>(null);
	return { palette, dispatchPalette, openedFile, setOpenedFile };
}
