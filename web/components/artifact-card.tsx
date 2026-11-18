/** `ArtifactCard`: the transcript's tile for a saved artifact version, which opens it, or reads Showing while the Artifacts tab has that version on screen. */
import type { ArtifactSave } from "../../src/shared/artifacts";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { ARTIFACT_KIND } from "./artifact-view";

export function ArtifactCard({ save, number, showing, onOpen }: { save: ArtifactSave; number: number; showing: boolean; onOpen: () => void }) {
	const kind = ARTIFACT_KIND[save.kind];
	return (
		<button
			{...activityControl("transcript.artifact-open")}
			type="button"
			data-item="artifact"
			// No aria-label: the title, the kind, version, and note line, and Open or Showing name the button as they read.
			aria-current={showing || undefined}
			onClick={onOpen}
			className={cn(
				"group/artifact my-1 flex w-full max-w-sm cursor-pointer items-center gap-3 self-start rounded-lg border border-border bg-card p-2 pr-3 text-left text-sm transition-colors hover:bg-hover/50",
				"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
				showing && "border-foreground/25",
			)}
		>
			<span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground">
				<kind.icon className="size-4" />
			</span>
			<span className="min-w-0 flex-1">
				<span title={save.title} className="block truncate text-sm font-medium">{save.title}</span>
				<span className="block truncate text-xs text-muted-foreground">
					{kind.label} · Version {number}
					{save.note && ` · ${save.note}`}
				</span>
			</span>
			<span className={cn("shrink-0 text-xs font-medium text-muted-foreground", !showing && "opacity-0 group-hover/artifact:opacity-100 group-focus-visible/artifact:opacity-100 pointer-coarse:opacity-100")}>
				{showing ? "Showing" : "Open"}
			</span>
		</button>
	);
}
