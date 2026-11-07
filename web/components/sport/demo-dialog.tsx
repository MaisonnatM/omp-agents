/** The demo dialog: one exercise's video, its three cues and caution, and the workout's other demos to step through. */
import { ChevronLeft, ChevronRight, Play, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Exercise } from "../../../src/shared/sport";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { dose } from "../../sport-view";
import { FormDialog, FormDialogHeader } from "../form-dialog";
import { DemoThumb } from "./demo-strip";

interface DemoDialogProps {
	/** What the demos belong to: a workout's or a routine's name. */
	title: string;
	/** Every one has a demo. */
	demos: Exercise[];
	at: number;
	onAt: (at: number) => void;
	onClose: () => void;
}

export function DemoDialog({ title, demos, at, onAt, onClose }: DemoDialogProps) {
	const [playing, setPlaying] = useState<number | null>(null);
	const strip = useRef<HTMLUListElement>(null);
	const exercise = demos[at];
	const demo = exercise?.demo ?? null;
	const last = at === demos.length - 1;
	useShortcuts({
		sportPreviousDay: () => { if (at > 0) onAt(at - 1); },
		sportNextDay: () => { if (!last) onAt(at + 1); },
	});
	useEffect(() => {
		strip.current?.children[at]?.scrollIntoView({ block: "nearest", inline: "center" });
	}, [at]);
	if (!exercise || !demo) return null;
	const shown = dose(exercise);
	return (
		<FormDialog busy={false} onClose={onClose} className="top-[6%] w-[min(40rem,calc(100vw-2rem))]">
			<FormDialogHeader title={`${title} · ${at + 1} sur ${demos.length}`} busy={false} />
			<div className="flex flex-col gap-4 px-5 pt-2 pb-4">
				<div>
					<h2 className="text-lg font-semibold">{exercise.name}</h2>
					{shown && <p className="text-sm text-muted-foreground">{shown}</p>}
				</div>
				<div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-muted">
					{playing === at ? (
						<iframe
							title={`Démo : ${exercise.name}`}
							src={`https://www.youtube-nocookie.com/embed/${demo.youtubeId}?autoplay=1&rel=0&playsinline=1`}
							referrerPolicy="strict-origin-when-cross-origin"
							allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
							allowFullScreen
							className="size-full"
						/>
					) : (
						<button type="button" aria-label={`Lire la vidéo : ${exercise.name}`} onClick={() => setPlaying(at)} {...activityControl("sport.demo.play")} className="group size-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
							<DemoThumb exercise={exercise} className="size-full" />
							<span className="absolute inset-0 flex items-center justify-center">
								<span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105">
									<Play aria-hidden className="size-6 fill-current" />
								</span>
							</span>
						</button>
					)}
				</div>
				<ol aria-label="À surveiller" className="flex flex-col gap-2 text-sm">
					{demo.cues.map((cue, index) => (
						<li key={index} className="flex gap-2.5">
							<span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground tabular-nums">{index + 1}</span>
							<span>{cue}</span>
						</li>
					))}
				</ol>
				{demo.caution && (
					<p className="flex gap-2 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
						<TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
						<span>{demo.caution}</span>
					</p>
				)}
				<p className="text-xs text-muted-foreground">
					Vidéo : {demo.by} ·{" "}
					<a href={`https://www.youtube.com/watch?v=${demo.youtubeId}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">ouvrir sur YouTube ↗</a>
				</p>
				{demos.length > 1 && (
					<ul ref={strip} aria-label="Démos de la séance" className="flex gap-2 overflow-x-auto py-1">
						{demos.map((other, index) => (
							<li key={`${other.key}-${index}`} className="w-20 shrink-0">
								<button type="button" aria-label={other.name} aria-current={index === at ? "true" : undefined} onClick={() => onAt(index)} className={cn("block aspect-video w-full overflow-hidden rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring", index === at ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100")}>
									<DemoThumb exercise={other} className="size-full text-[10px]" />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
				<Tooltip content="Démo précédente" shortcut={shortcutLabels("sportPreviousDay")} side="top" disabled={at === 0}>
					<Button variant="tertiary" size="compact" leadingIcon={ChevronLeft} disabled={at === 0} onClick={() => onAt(at - 1)}>Précédent</Button>
				</Tooltip>
				{last ? (
					<Button size="compact" onClick={onClose}>Terminé</Button>
				) : (
					<Tooltip content="Démo suivante" shortcut={shortcutLabels("sportNextDay")} side="top">
						<Button size="compact" trailingIcon={ChevronRight} onClick={() => onAt(at + 1)}>Suivant</Button>
					</Tooltip>
				)}
			</div>
		</FormDialog>
	);
}
