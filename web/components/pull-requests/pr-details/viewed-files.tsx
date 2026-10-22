import { createContext, useContext, useMemo, useState } from "react";
import type { ChangedEntry } from "../../../../src/shared/changes";
import type { PullRequest, PullRequestChangedEntry } from "../../../../src/shared/github";
import { errorText } from "../../../api";
import { withMember } from "../../../changes-model";
import { writeViewedFile } from "../../../reads";

/** GitHub's viewed state of the Code tab's files, as the checkbox in each file's header reads and sets it. */
export interface ViewedFiles {
	isViewed: (path: string) => boolean;
	/** Marked viewed, then changed by a later push. */
	isStale: (path: string) => boolean;
	isPending: (path: string) => boolean;
	mark: (path: string, on: boolean) => void;
}

export const ViewedFilesContext = createContext<ViewedFiles | null>(null);

/**
 * The viewed state of `files` as the list read it, with the marks made since over it until the list reads again. A mark
 * writes GitHub at once, folds or opens the file's diff through `onCollapse`, and drops back to the read state when
 * GitHub refuses it.
 */
export function useViewedFiles(
	pr: PullRequest,
	files: readonly PullRequestChangedEntry[] | undefined,
	onCollapse: (path: string, value: boolean) => void,
): { viewedFiles: ViewedFiles; viewedCount: number; saveError: string | null } {
	const [overlay, setOverlay] = useState<ReadonlyMap<string, boolean>>(new Map());
	const [readFiles, setReadFiles] = useState(files);
	if (readFiles !== files) {
		setReadFiles(files);
		setOverlay(new Map());
	}
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	const [saveError, setSaveError] = useState<string | null>(null);
	const states = useMemo(() => new Map(files?.map(file => [file.path, file.viewed])), [files]);
	const isViewed = (path: string): boolean => overlay.get(path) ?? states.get(path) === "VIEWED";
	const mark = async (path: string, on: boolean): Promise<void> => {
		setSaveError(null);
		setOverlay(previous => new Map(previous).set(path, on));
		setPending(previous => withMember(previous, path, true));
		onCollapse(path, on);
		try {
			await writeViewedFile(pr, path, on);
		} catch (error) {
			setOverlay(previous => new Map([...previous].filter(([marked]) => marked !== path)));
			setSaveError(errorText(error));
		} finally {
			setPending(previous => withMember(previous, path, false));
		}
	};
	const viewedFiles: ViewedFiles = {
		isViewed,
		isStale: path => states.get(path) === "DISMISSED" && !overlay.has(path),
		isPending: path => pending.has(path),
		mark: (path, on) => void mark(path, on),
	};
	return { viewedFiles, viewedCount: files?.filter(file => isViewed(file.path)).length ?? 0, saveError };
}

/** The Viewed checkbox in a file's header, the Code tab's `FileHeader`. */
export function ViewedToggle({ file }: { file: ChangedEntry }) {
	const viewed = useContext(ViewedFilesContext);
	if (!viewed) throw new Error("ViewedToggle must be used within the Code tab's ViewedFilesContext.Provider");
	return (
		<label className="flex min-h-6 shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground">
			<input
				type="checkbox"
				aria-label={`Viewed ${file.path}`}
				checked={viewed.isViewed(file.path)}
				disabled={viewed.isPending(file.path)}
				onChange={event => viewed.mark(file.path, event.target.checked)}
			/>
			{viewed.isStale(file.path) ? "Changed" : "Viewed"}
		</label>
	);
}
