/** A file path in agent text that opens the file dialog, and the context giving where relative paths start. */
import { createContext, type ReactNode, useContext } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { type FileBase, fileTarget } from "../file-paths";
import { DashboardActionsContext } from "./dashboard-context";

/** Where a relative path in agent text starts: the session's directory, or the open file's. */
export const FileBaseContext = createContext<FileBase | null>(null);

/** A text file that agent text names, which opens in the file dialog; plain text when nothing resolves a relative path. */
export function FileLink({ path, children }: { path: string; children: ReactNode }) {
	const openFile = useContext(DashboardActionsContext)?.openFile;
	const target = fileTarget(path, useContext(FileBaseContext));
	if (!openFile || target === null) return children;
	// A span, not a button: a button lays out as an inline block, so a long path would jump to its own line instead of wrapping in the sentence.
	return (
		<Tooltip content={target.path}>
			<span
				{...activityControl("file-dialog.open")}
				role="button"
				tabIndex={0}
				className="file-link"
				onClick={() => openFile(target)}
				onKeyDown={(event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					openFile(target);
				}}
			>
				{children}
			</span>
		</Tooltip>
	);
}
