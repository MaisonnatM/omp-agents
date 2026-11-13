/** A workout's demos as a row of thumbnails, each opening the demo dialog on its exercise. */
import { IconPlay } from "central-icons";
import { type ReactNode, useState } from "react";
import type { Exercise } from "../../../src/shared/sport";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { mediaSrc } from "../../api";

/**
 * A demo's thumbnail, which this server keeps from YouTube; the exercise's name stands in when YouTube has none.
 * `badge`, such as a play button, sits over the picture's middle, or above the name without one so it never covers it,
 * which then leaves the name one line; the caller's box is `relative`.
 */
export function DemoThumb({ exercise, className, badge }: { exercise: Exercise; className?: string; badge?: ReactNode }) {
	const [failed, setFailed] = useState<string | null>(null);
	const id = exercise.demo?.youtubeId ?? null;
	if (id === null || failed === id) {
		return (
			<span className={cn("flex flex-col items-center justify-center gap-1 bg-muted p-1.5 text-center text-xs leading-tight text-muted-foreground", className)}>
				{badge}
				<span className={cn("max-w-full", badge ? "truncate" : "line-clamp-2")}>{exercise.name}</span>
			</span>
		);
	}
	return (
		<>
			<img src={mediaSrc(`/api/sport/thumb?id=${id}`)} alt="" loading="lazy" onError={() => setFailed(id)} className={cn("bg-muted object-cover", className)} />
			{badge && <span className="absolute inset-0 flex items-center justify-center">{badge}</span>}
		</>
	);
}

export function DemoStrip({ demos, onOpen }: { demos: Exercise[]; onOpen: (at: number) => void }) {
	if (demos.length === 0) return null;
	return (
		<div className="flex flex-col gap-2">
			<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Démos · {demos.length} {demos.length === 1 ? "exercice" : "exercices"}</p>
			<ul aria-label="Démos" className="flex gap-2 overflow-x-auto pb-1">
				{demos.map((exercise, at) => (
					<li key={`${exercise.key}-${at}`} className="w-28 shrink-0">
						<button type="button" aria-label={`Démo : ${exercise.name}`} onClick={() => onOpen(at)} {...activityControl("sport.demo.open")} className="group flex w-full flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
							<span className="relative block aspect-video overflow-hidden rounded-md border border-border">
								<DemoThumb
									exercise={exercise}
									className="size-full"
									badge={
										<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm group-hover:bg-background">
											<IconPlay aria-hidden className="size-3.5 fill-current" />
										</span>
									}
								/>
							</span>
							<span className="truncate text-xs text-muted-foreground group-hover:text-foreground">{exercise.name}</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
