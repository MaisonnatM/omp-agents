import { createContext, type ReactNode, useContext } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { absoluteFilePath } from "../file-paths";
import { DashboardActionsContext } from "./dashboard-context";

/** The directory a relative path in agent text resolves against: the session's, or the open file's. */
export const FileBaseContext = createContext<string | null>(null);

/** A text file that agent text names, which opens in the file dialog; plain text when nothing resolves a relative path. */
export function FileLink({ path, children }: { path: string; children: ReactNode }) {
	const openFile = useContext(DashboardActionsContext)?.openFile;
	const target = absoluteFilePath(path, useContext(FileBaseContext));
	if (!openFile || target === null) return children;
	return (
		<Tooltip content={target}>
			<button type="button" className="file-link" onClick={() => openFile(target)}>
				{children}
			</button>
		</Tooltip>
	);
}
