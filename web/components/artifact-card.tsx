/** `ArtifactCard`: the transcript's line for a saved artifact version, with Open, or Showing while the Artifacts tab has that version on screen. */
import { IconSparklesTwo } from "central-icons";
import type { ArtifactSave } from "../../src/shared/artifacts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activityControl } from "../activity";
import { ARTIFACT_KIND } from "./artifact-view";

export function ArtifactCard({ save, number, showing, onOpen }: { save: ArtifactSave; number: number; showing: boolean; onOpen: () => void }) {
	return (
		<div className="flex max-w-full items-center gap-2 self-start text-sm text-muted-foreground" data-item="artifact">
			<IconSparklesTwo aria-hidden className="size-4 shrink-0" />
			<span className="min-w-0">
				Saved <span className="font-medium text-foreground">{save.title}</span> as version {number}
			</span>
			{showing ? (
				<Badge variant="dot" size="default" color="blue" className="ml-1 shrink-0">
					Showing
				</Badge>
			) : (
				<Button
					{...activityControl("transcript.artifact-open")}
					variant="outline"
					size="xs"
					leadingIcon={ARTIFACT_KIND[save.kind].icon}
					aria-label={`Open ${save.title}, version ${number}`}
					onClick={onOpen}
					className="ml-1 shrink-0 pointer-coarse:after:absolute pointer-coarse:after:-inset-2"
				>
					Open
				</Button>
			)}
		</div>
	);
}
