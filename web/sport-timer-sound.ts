/**
 * The routine timer's sound: Web Audio beeps over a step's last three seconds and a rising tone as it ends, scheduled
 * on the audio clock so a hidden tab's slowed timers do not shift them, and cues spoken in French.
 */

/** Whether the timer's sound is on, which the last run's toggle leaves. */
const SOUND_KEY = "omp-agents.sport-timer-sound";

export const soundWanted = (): boolean => localStorage.getItem(SOUND_KEY) !== "off";

export const rememberSound = (on: boolean): void => localStorage.setItem(SOUND_KEY, on ? "on" : "off");

const BEEP = { hz: 880, sec: 0.12 };
/** The end tone's two notes, the second starting as the first fades. */
const TONE = [
	{ hz: 660, sec: 0.18, after: 0 },
	{ hz: 990, sec: 0.32, after: 0.16 },
];
const VOLUME = 0.3;

export class TimerSound {
	readonly #audio: AudioContext | null = typeof AudioContext === "undefined" ? null : new AudioContext();
	#planned: { node: OscillatorNode; at: number }[] = [];

	/** Build it in the click that opens the timer: a browser plays sound and speech only after one. */
	constructor() {
		void this.#audio?.resume();
		// Safari speaks later only after a first utterance in a click.
		if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
	}

	/** Beeps on each of the last three seconds of a step that ends `leftMs` from now, and the tone as it ends, in place of what was planned. */
	plan(leftMs: number): void {
		this.cancel();
		const audio = this.#audio;
		if (!audio) return;
		const end = audio.currentTime + leftMs / 1000;
		for (const before of [3, 2, 1]) {
			const at = end - before;
			// A beep just missed, by a frame, still plays.
			if (at > audio.currentTime - 0.05) this.#note(Math.max(at, audio.currentTime), BEEP.hz, BEEP.sec);
		}
		this.#tone(end);
	}

	/** The tone that marks a change of step, now, for a step the user skipped to. */
	tone(): void {
		if (this.#audio) this.#tone(this.#audio.currentTime);
	}

	#tone(at: number): void {
		for (const { hz, sec, after } of TONE) this.#note(at + after, hz, sec, at);
	}

	/** A note at `at`, which {@link cancel} drops only while its `group`, the start of the sound it is part of, is still ahead. */
	#note(at: number, hz: number, sec: number, group = at): void {
		const audio = this.#audio!;
		const node = audio.createOscillator();
		const gain = audio.createGain();
		node.frequency.value = hz;
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + sec);
		node.connect(gain).connect(audio.destination);
		node.start(at);
		node.stop(at + sec + 0.02);
		const planned = { node, at: group };
		this.#planned.push(planned);
		node.onended = () => {
			this.#planned = this.#planned.filter(other => other !== planned);
		};
	}

	/** Drops the beeps and tones that have not started. */
	cancel(): void {
		const now = this.#audio?.currentTime ?? 0;
		for (const { node, at } of this.#planned) if (at > now) node.stop();
		this.#planned = this.#planned.filter(({ at }) => at <= now);
	}

	/** Says `text` in French, cutting off what it was saying; nothing where the browser cannot speak. */
	speak(text: string): void {
		if (!("speechSynthesis" in window)) return;
		speechSynthesis.cancel();
		const words = new SpeechSynthesisUtterance(text);
		words.lang = "fr-FR";
		const voice = speechSynthesis.getVoices().find(({ lang }) => lang.replace("_", "-").startsWith("fr"));
		if (voice) words.voice = voice;
		speechSynthesis.speak(words);
	}

	/** Stops what is planned and what is being said. */
	hush(): void {
		this.cancel();
		if ("speechSynthesis" in window) speechSynthesis.cancel();
	}

	close(): void {
		this.hush();
		void this.#audio?.close();
	}
}
