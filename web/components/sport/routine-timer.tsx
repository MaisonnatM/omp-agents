/**
 * The routine timer: a routine's holds counted down over the whole screen, its color telling a hold from the time
 * between, with beeps and a French voice, ticking each item on the open day as its last hold ends.
 */
import { CircleCheck, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Plan, Routine } from "../../../src/shared/sport";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { shortcutLabels, usePopupShortcuts } from "../../shortcuts";
import { advance, clockText, freshCue, goTo, holdText, pauseRun, ranAt, resumeRun, secondsLeft, spanText, spokenCue, startRun, stepTitle, timerNote, timerSteps, type TimerRun, type TimerStep } from "../../sport-timer";
import { rememberSound, soundWanted, type TimerSound } from "../../sport-timer-sound";
import { demosOf, longDate } from "../../sport-view";
import { SportDialog } from "./sport-dialog";

interface RoutineTimerProps {
	plan: Plan;
	routine: Routine;
	/** The day the routine is done for, whose ticks it adds to. */
	date: string;
	/** The routine's items ticked that day, as saved. */
	ticked: string[];
	/** Built in the click that opened the timer, since a browser plays sound only after one. */
	sound: TimerSound;
	/** Saves the day's ticks of the routine. */
	onTick: (items: string[]) => void;
	onClose: () => void;
}

/** What the screen shows: a hold, the time between two, or the end, celebrated when every item is ticked and plain when the user stopped short. */
type Phase = "hold" | "between" | "done" | "stopped";

/**
 * Each phase's ink, made the dialog's foreground so its title, buttons, and text follow it.
 * Every fill below keeps its ink at WCAG 5:1 or more, paused fills included.
 */
const INK: Record<Phase, string> = {
	hold: "[--foreground:white] [--muted-foreground:white]",
	between: "[--foreground:oklch(0.2_0.01_260)] [--muted-foreground:oklch(0.2_0.01_260)]",
	done: "[--foreground:white] [--muted-foreground:white]",
	stopped: "[--foreground:oklch(0.2_0.01_260)] [--muted-foreground:oklch(0.2_0.01_260)] dark:[--foreground:white] dark:[--muted-foreground:white]",
};

/** A hold is a deep green and the time between a light amber, 0.3 apart in lightness so they tell apart without their hue; a shade darker in dark mode. */
const FILL: Record<Phase, string> = {
	hold: "[--timer-fill:oklch(0.52_0.13_152)] dark:[--timer-fill:oklch(0.45_0.115_152)]",
	between: "[--timer-fill:oklch(0.82_0.14_78)] dark:[--timer-fill:oklch(0.76_0.14_72)]",
	done: "[--timer-fill:oklch(0.5_0.14_255)] dark:[--timer-fill:oklch(0.45_0.13_255)]",
	stopped: "[--timer-fill:oklch(0.88_0.005_260)] dark:[--timer-fill:oklch(0.32_0.01_260)]",
};

/** The same fills nearly gray while the run is paused. */
const PAUSED: Record<"hold" | "between", string> = {
	hold: "[--timer-fill:oklch(0.52_0.035_152)] dark:[--timer-fill:oklch(0.45_0.03_152)]",
	between: "[--timer-fill:oklch(0.82_0.035_78)] dark:[--timer-fill:oklch(0.76_0.03_72)]",
};

/** The whole screen on a phone, sized to what it shows even when the page is wider; a large panel from `md` up. */
const FRAME =
	"inset-0 left-0 h-dvh max-h-none w-dvw max-w-[100dvw] translate-x-0 rounded-none border-0 bg-(--timer-fill) text-foreground transition-colors duration-300 motion-reduce:transition-none md:inset-auto md:top-[5vh] md:left-1/2 md:h-[min(48rem,90vh)] md:w-[min(56rem,calc(100vw-4rem))] md:-translate-x-1/2 md:rounded-2xl md:border";

/** The header's buttons: a finger's 44 px on a phone. */
const HEADER_BUTTON = "size-11 [&_svg]:size-5 md:size-7 md:[&_svg]:size-3.5";

/** The phase's ink filled with its fill: the play button and the end's button, standing out on any fill. */
const INVERTED = "rounded-full bg-foreground text-(--timer-fill) outline-offset-4 outline-foreground focus-visible:outline-2 disabled:opacity-50";

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function RoutineTimer({ plan, routine, date, ticked, sound, onTick, onClose }: RoutineTimerProps) {
	// The run keeps the routine it started with, so a plan saved meanwhile cannot shift its steps.
	const [{ items, steps, started }] = useState(() => ({ items: routine.items, steps: timerSteps(routine.items), started: performance.now() }));
	const [run, setRun] = useState<TimerRun>(() => startRun(started));
	const [now, setNow] = useState(started);
	const [finished, setFinished] = useState<number | null>(null);
	const [soundOn, setSoundOn] = useState(soundWanted);
	const latest = useRef({ run, ticked, onTick, soundOn });
	latest.current = { run, ticked, onTick, soundOn };
	/** The items this run ticked, which a save still on its way has not brought back in `ticked`. */
	const sent = useRef(new Set<string>());
	/** Takes the focus as the timer opens, so no button shows its tooltip and Space reaches the shortcut. */
	const stage = useRef<HTMLDivElement>(null);
	const step = steps[run.at] ?? null;
	const running = run.since !== null;

	/** Ticks the items whose last hold is among `ended`, added to what the day has. */
	const tick = (ended: readonly TimerStep[]) => {
		const keys = ended.filter(({ kind, hold }) => kind === "hold" && hold.last).map(({ hold }) => hold.item.key);
		if (keys.length === 0) return;
		for (const key of keys) sent.current.add(key);
		const saved = latest.current.ticked;
		const all = [...new Set([...saved, ...sent.current])];
		if (all.length === new Set(saved).size) return;
		const place = (key: string) => {
			const at = items.findIndex(item => item.key === key);
			return at === -1 ? items.length : at;
		};
		latest.current.onTick(all.sort((a, b) => place(a) - place(b)));
	};

	const move = (next: TimerRun, at: number) => {
		const over = next.at >= steps.length;
		const moved = over ? { ...next, since: null } : next;
		latest.current.run = moved;
		setRun(moved);
		setNow(at);
		if (over) setFinished(done => done ?? at);
	};

	const go = (to: number) => {
		const at = performance.now();
		const wasRunning = latest.current.run.since !== null;
		move(goTo(latest.current.run, to, at), at);
		if (wasRunning && latest.current.soundOn) sound.tone();
	};

	const toggle = () => {
		if (step === null) return false;
		const at = performance.now();
		const next = running ? pauseRun(run, at) : resumeRun(run, at);
		latest.current.run = next;
		setRun(next);
		setNow(at);
	};

	const previous = () => {
		if (step === null) return false;
		go(Math.max(0, run.at - 1));
	};

	const next = () => {
		if (step === null) return false;
		// A hold the user ends is done when they say so; a timed one skipped is not.
		if (step.sec === null) tick([step]);
		go(run.at + 1);
	};

	const keys = usePopupShortcuts({ sportTimerPause: toggle, sportTimerPrevious: previous, sportTimerNext: next });

	// The clock: a quarter-second beat that ends each step that ran out, every one of them after a hidden tab's slower beat.
	useEffect(() => {
		if (!running) return;
		const beat = setInterval(() => {
			const at = performance.now();
			const { run: next, ended } = advance(steps, latest.current.run, at);
			setNow(at);
			if (ended.length === 0) return;
			move(next, at);
			tick(ended);
		}, 250);
		return () => clearInterval(beat);
		// `move` and `tick` read the run and the ticks through `latest`, so the beat outlives renders.
	}, [running, steps]);

	// The beeps of the step under way, planned again whenever the run moves, pauses, or resumes.
	useEffect(() => {
		const sec = steps[run.at]?.sec ?? null;
		if (!soundOn || run.since === null || sec === null) sound.cancel();
		else sound.plan(sec * 1000 - ranAt(run, performance.now()));
	}, [sound, soundOn, run, steps]);

	// The voice, as each step starts.
	useEffect(() => {
		if (!latest.current.soundOn) return;
		const entered = steps[run.at];
		const cue = entered ? spokenCue(entered) : "Terminé";
		if (cue) sound.speak(cue);
	}, [sound, run.at, steps]);

	useEffect(() => () => sound.close(), [sound]);

	// The screen stays on while the run counts; where the browser refuses or lacks the lock, it dims as usual.
	useEffect(() => {
		if (!running || !("wakeLock" in navigator)) return;
		let lock: WakeLockSentinel | null = null;
		let released = false;
		const take = () => {
			if (document.visibilityState !== "visible") return;
			navigator.wakeLock.request("screen").then(
				taken => {
					if (released) void taken.release();
					else lock = taken;
				},
				() => {},
			);
		};
		take();
		// The browser drops the lock when the tab hides.
		document.addEventListener("visibilitychange", take);
		return () => {
			released = true;
			document.removeEventListener("visibilitychange", take);
			void lock?.release();
		};
	}, [running]);

	const toggleSound = () => {
		const on = !soundOn;
		setSoundOn(on);
		rememberSound(on);
		if (!on) sound.hush();
	};

	const tickedCount = items.filter(({ key }) => ticked.includes(key) || sent.current.has(key)).length;
	const phase: Phase = step === null ? (tickedCount === items.length ? "done" : "stopped") : step.kind === "hold" ? "hold" : "between";
	const fill = step === null || running ? FILL[phase] : PAUSED[step.kind === "hold" ? "hold" : "between"];
	return (
		<SportDialog
			title={`${routine.name} · ${longDate(date)}`}
			onClose={onClose}
			className={cn(FRAME, INK[phase], fill)}
			closeClassName={HEADER_BUTTON}
			initialFocus={stage}
			onKeyDown={keys}
			actions={
				<Tooltip content={soundOn ? "Couper le son" : "Remettre le son"} side="bottom">
					<Button variant="ghost" size="icon-compact" className={cn("text-foreground", HEADER_BUTTON)} aria-label="Son" aria-pressed={soundOn} onClick={toggleSound} {...activityControl("sport.timer.sound")}>
						{soundOn ? <Volume2 /> : <VolumeX />}
					</Button>
				</Tooltip>
			}
		>
			{step === null ? (
				<Done name={routine.name} taken={(finished ?? now) - started} ticked={tickedCount} of={items.length} onClose={onClose} />
			) : (
				<div ref={stage} tabIndex={-1} className="flex flex-1 flex-col items-center gap-6 px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center outline-none">
					<StepView plan={plan} steps={steps} step={step} run={run} now={now} />
					<div className="flex items-center gap-6">
						<Tooltip content="Étape précédente" shortcut={shortcutLabels("sportTimerPrevious")}>
							<Button variant="ghost" size="icon" className="size-12 rounded-full text-foreground [&_svg]:h-6 [&_svg]:w-6" aria-label="Étape précédente" onClick={previous} {...activityControl("sport.timer.step")}>
								<SkipBack />
							</Button>
						</Tooltip>
						<Tooltip content={running ? "Pause" : "Reprendre"} shortcut={shortcutLabels("sportTimerPause")}>
							<button type="button" className={cn(INVERTED, "grid size-20 place-items-center [&_svg]:size-8 [&_svg]:fill-current")} aria-label={running ? "Pause" : "Reprendre"} onClick={toggle} {...activityControl("sport.timer.pause")}>
								{running ? <Pause /> : <Play />}
							</button>
						</Tooltip>
						<Tooltip content="Étape suivante" shortcut={shortcutLabels("sportTimerNext")}>
							<Button variant="ghost" size="icon" className="size-12 rounded-full text-foreground [&_svg]:h-6 [&_svg]:w-6" aria-label="Étape suivante" onClick={next} {...activityControl("sport.timer.step")}>
								<SkipForward />
							</Button>
						</Tooltip>
					</div>
				</div>
			)}
		</SportDialog>
	);
}

interface StepViewProps {
	plan: Plan;
	steps: readonly TimerStep[];
	step: TimerStep;
	run: TimerRun;
	now: number;
}

/**
 * The step under way, in three groups: what it is over its countdown in a ring, then the hold it is or leads to, then what follows and what is left.
 * A pause shows in the ring as well as in the grayed fill.
 */
function StepView({ plan, steps, step, run, now }: StepViewProps) {
	const { hold } = step;
	const { item } = hold;
	const holds = steps.filter(({ kind }) => kind === "hold");
	const after = holds[hold.index + 1]?.hold ?? null;
	const left = step.sec === null ? null : Math.max(0, Math.ceil((step.sec * 1000 - ranAt(run, now)) / 1000));
	// The ring moves with the countdown's seconds; with reduced motion it steps, without it glides between them.
	const done = step.sec === null || left === null ? 0 : (step.sec - left) / step.sec;
	const side = holdText(hold);
	const note = timerNote(item.note, hold.side !== null);
	const cue = freshCue(demosOf(plan, [item])[0]?.demo?.cues[0] ?? null, note);
	const paused = run.since === null;
	const clock = left === null ? null : clockText(left);
	return (
		<>
			<div className="flex flex-1 flex-col items-center justify-center gap-6">
				<div className="flex flex-col items-center gap-3">
					<p aria-live="polite" className="text-sm font-semibold tracking-widest uppercase">
						{stepTitle(step)}
						<span className="sr-only">
							{paused && ", en pause"} : {item.name}
							{side && `, ${side}`}
						</span>
					</p>
					<div className="relative grid size-[min(80vw,38dvh,24rem)] shrink-0 place-items-center">
						<svg viewBox="0 0 100 100" aria-hidden className="absolute inset-0 -rotate-90">
							<circle cx={50} cy={50} r={RADIUS} fill="none" stroke="currentColor" strokeWidth={4} className="opacity-20" />
							<circle
								key={run.at}
								cx={50}
								cy={50}
								r={RADIUS}
								fill="none"
								stroke="currentColor"
								strokeWidth={4}
								strokeLinecap="round"
								strokeDasharray={CIRCUMFERENCE}
								strokeDashoffset={CIRCUMFERENCE * done}
								className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
							/>
						</svg>
						<span className="relative flex flex-col items-center gap-2">
							{clock === null ? (
								<>
									<span className="text-[min(32vw,17dvh,10rem)] leading-none font-semibold tabular-nums">{item.reps ?? "—"}</span>
									<span className="text-sm">{item.reps === null ? "à ton rythme" : "répétitions"}</span>
								</>
							) : (
								// A minute or more takes four characters, drawn smaller to stay inside the ring.
								<span role="timer" className={cn("leading-none font-semibold tabular-nums", clock.length > 2 ? "text-[min(20vw,11dvh,6.5rem)]" : "text-[min(32vw,17dvh,10rem)]")}>
									{clock}
								</span>
							)}
							{paused && <span className="text-xl font-semibold tracking-widest uppercase">En pause</span>}
						</span>
					</div>
				</div>
				<div className="flex max-w-prose flex-col items-center gap-1">
					<h2 className="text-2xl font-semibold text-balance">{item.name}</h2>
					{side && <p className="text-base font-medium">{side}</p>}
					{note && <p className="text-sm text-balance">{note}</p>}
					{cue && <p className="text-sm text-balance italic">« {cue} »</p>}
					{step.sec === null && <p className="text-sm">Quand c'est fait, passe à l'étape suivante.</p>}
				</div>
			</div>
			<div className="flex flex-col items-center gap-0.5 text-sm">
				{after && <p className="text-balance">{`Ensuite : ${after.item.name}${holdText(after) && ` · ${holdText(after)}`}`}</p>}
				<p className="tabular-nums">
					{after ? `Tenue ${hold.index + 1} / ${holds.length}` : "Dernière tenue"} · {spanText(secondsLeft(steps, run, now))} restantes
				</p>
			</div>
		</>
	);
}

interface DoneProps {
	name: string;
	/** Milliseconds from the start to the end, pauses included. */
	taken: number;
	ticked: number;
	of: number;
	onClose: () => void;
}

/** The end: celebrated when every item is ticked, a plain « Arrêté » when some were skipped. */
function Done({ name, taken, ticked, of, onClose }: DoneProps) {
	const all = ticked === of;
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-center">
			{all && <CircleCheck aria-hidden className="size-14" strokeWidth={1.5} />}
			<h2 aria-live="polite" className="text-4xl font-semibold">
				{all ? "Terminé" : "Arrêté"}
			</h2>
			<p className="text-base">
				{name} en {spanText(Math.round(taken / 1000))}
			</p>
			<p className="text-sm tabular-nums">
				{ticked} / {of} cochés
			</p>
			<button type="button" className={cn(INVERTED, "mt-3 h-10 px-6 text-sm font-medium")} autoFocus onClick={onClose} {...activityControl("sport.timer.close")}>
				Fermer
			</button>
		</div>
	);
}
