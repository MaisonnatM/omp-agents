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
			aria-label={`Open ${save.title}, version ${number}`}
			aria-current={showing || undefined}
			onClick={onOpen}
			className={cn(
				"group/artifact my-1 flex w-full max-w-sm cursor-pointer items-center gap-3 self-start rounded-xl border border-border bg-background p-2 pr-3 text-left shadow-surface-1 transition-colors hover:bg-accent/50",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				showing && "border-foreground/25",
			)}
		>
			<span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground">
				<kind.icon className="size-4.5" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium">{save.title}</span>
				<span className="block truncate text-xs text-muted-foreground">
					{kind.label} · Version {number}
					{save.note && ` · ${save.note}`}
				</span>
			</span>
			<span className={cn("shrink-0 text-xs font-medium", showing ? "text-muted-foreground" : "text-muted-foreground/0 group-hover/artifact:text-muted-foreground group-focus-visible/artifact:text-muted-foreground")}>
				{showing ? "Showing" : "Open"}
			</span>
		</button>
	);
}
