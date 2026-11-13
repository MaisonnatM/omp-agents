import { IconFileText } from "central-icons";
import type { PromptFile } from "../../src/shared/prompt-files";
import { useShape } from "@/lib/shape-context";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";

/** The files a sent prompt carried as text, such as a long paste, each a chip that opens it. */
export function PromptFileChips({ files, onOpen }: { files: readonly PromptFile[]; onOpen: (file: PromptFile) => void }) {
	const shape = useShape();
	const chip = cn(
		"inline-flex h-7 max-w-60 cursor-pointer items-center gap-1.5 px-2.5 text-[12px] text-muted-foreground bg-accent outline-1 -outline-offset-1 outline-black/10 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:outline-white/10",
		shape.bg,
	);
	// A message's files never change, so their order names them.
	return files.map((file, index) => (
		<button
			{...activityControl("file-dialog.open-attached")}
			key={index}
			type="button"
			title={file.name}
			aria-label={`Open ${file.name}`}
			aria-haspopup="dialog"
			onClick={() => onOpen(file)}
			className={chip}
		>
			<IconFileText size={14} aria-hidden="true" className="shrink-0" />
			<span className="truncate">{file.name}</span>
		</button>
	));
}
