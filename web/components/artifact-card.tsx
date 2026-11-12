/** `ArtifactCard`: the transcript's line for a saved artifact version, with Open, or Showing while the Artifacts tab has that version on screen. */
import { Sparkles } from "lucide-react";
import type { ArtifactSave } from "../../src/shared/artifacts";
import { activityControl } from "../activity";
import { ARTIFACT_KIND } from "./artifact-view";

const CHIP = "ml-1 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] [&>svg]:size-3.5";

export function ArtifactCard({ save, number, showing, onOpen }: { save: ArtifactSave; number: number; showing: boolean; onOpen: () => void }) {
	const { icon: Icon } = ARTIFACT_KIND[save.kind];
	return (
		<div className="flex max-w-full items-center gap-2 self-start text-sm text-muted-foreground" data-item="artifact">
			<Sparkles aria-hidden className="size-4 shrink-0" />
			<span className="min-w-0">
				Saved <span className="font-medium text-foreground">{save.title}</span> as version {number}
			</span>
			{showing ? (
				<span className={`${CHIP} bg-primary/10 text-primary`}>
					<Icon aria-hidden />
					Showing
				</span>
			) : (
				<button
					{...activityControl("transcript.artifact-open")}
					type="button"
					aria-label={`Open ${save.title}, version ${number}`}
					onClick={onOpen}
					className={`${CHIP} bg-muted text-foreground transition-colors duration-150 ease-out hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
				>
					<Icon aria-hidden />
					Open
				</button>
			)}
		</div>
	);
}
