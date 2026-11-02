/**
 * Dictation: speech from this computer's microphone, turned into text that lands in a composer's draft. The microphone
 * is the one the dashboard server runs on, and text is never sent on its own.
 */

/** The longest capture id the server takes, as omp's own dictation bridge allows. */
export const MAX_CAPTURE_ID = 128;

/** Where speech is turned into text: a model on this computer, a provider's model, or a model omp cannot dictate with. */
export type DictationProcessing =
	| { kind: "local"; model: string; size: string }
	| { kind: "cloud"; model: string }
	| { kind: "unsupported"; api: string };

/** Which settings layer gives `stt.enabled` its value: an environment variable, a workspace's config, the user's config, or omp's default. */
export type DictationSource = "env" | "runtime" | "overlay" | "project" | "global" | "default";

/** Whether dictation is on in a directory, what turns it on or off, and where its speech goes. */
export interface DictationSettings {
	enabled: boolean;
	enabledBy: DictationSource;
	language: string;
	processing: DictationProcessing;
}

/** Whether a workspace's config or the environment keeps dictation off, which turning it on for the user does not change. */
export const blockedByWorkspace = (settings: DictationSettings): boolean =>
	!settings.enabled && (settings.enabledBy === "project" || settings.enabledBy === "env");

/** One step of a capture: where speech goes, the microphone's state, the text so far, then always one `end`. */
export type DictationEvent =
	| { kind: "processing"; processing: DictationProcessing }
	| { kind: "state"; state: "starting" | "recording" | "transcribing" }
	/** All the text so far, replacing the last preview. */
	| { kind: "preview"; text: string }
	/** `text` is the whole transcript; `error` is why the capture failed, `null` when it ended well or was discarded. */
	| { kind: "end"; text: string; error: string | null };

/** What a capture says about where its speech goes: `Parakeet TDT v3 on this computer` or `openai/whisper-1, sent to its provider`. */
export function processingText(processing: DictationProcessing): string {
	switch (processing.kind) {
		case "local":
			return `${processing.model} on this computer`;
		case "cloud":
			return `${processing.model}, sent to its provider`;
		case "unsupported":
			return `a model omp cannot dictate with (${processing.api})`;
		default: {
			const unhandled: never = processing;
			return unhandled;
		}
	}
}
