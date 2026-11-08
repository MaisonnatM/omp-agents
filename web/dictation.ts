/**
 * The page's dictation: one capture at a time, since the server has one microphone, kept in memory for this page load only.
 * A capture belongs to the composer of one draft and the selection it had; its text replaces that selection, through the
 * composer while it is mounted, else in the kept draft, and is never sent on its own.
 */
import { useSyncExternalStore } from "react";
import { type DictationEvent, type DictationProcessing, type DictationSettings, processingText } from "../src/shared/dictation";
import type { ClientMsg, ServerMsg } from "../src/shared/protocol";
import { replaceInComposer } from "./composer-drafts";

/** The composer a capture belongs to: its draft, the directory whose settings it uses, its text then, and the selection the result replaces. */
export interface DictationTarget {
	draftKey: string;
	cwd: string;
	text: string;
	start: number;
	end: number;
}

/**
 * A capture under way or how it ended. `starting` until the microphone records, `listening` while it does, `transcribing`
 * once it stopped, `cancelling` once you stopped it while it started; `off` found dictation off in its directory, `empty`
 * heard nothing, `failed` says why, with what it heard before.
 */
export type Dictation =
	| Capturing
	| { phase: "off"; captureId: string; target: DictationTarget; settings: DictationSettings }
	| { phase: "empty"; captureId: string; target: DictationTarget }
	| { phase: "failed"; captureId: string; target: DictationTarget; error: string; preview: string };

/**
 * A capture that still holds the microphone, which keeps its composer's draft read-only. A `cancelling` one waits only for
 * its end, which puts nothing in the draft and says nothing.
 */
export interface Capturing {
	phase: "starting" | "listening" | "transcribing" | "cancelling";
	captureId: string;
	target: DictationTarget;
	preview: string;
	processing: DictationProcessing | null;
}

export const capturing = (dictation: Dictation | null): dictation is Capturing =>
	dictation?.phase === "starting" || dictation?.phase === "listening" || dictation?.phase === "transcribing" || dictation?.phase === "cancelling";

/** Whether Stop applies: a capture that transcribes or cancels already stopped, and only Discard ends it sooner. */
export const stoppable = (dictation: Dictation | null): dictation is Capturing => dictation?.phase === "starting" || dictation?.phase === "listening";

let current: Dictation | null = null;
const listeners = new Set<() => void>();

function set(next: Dictation | null): void {
	current = next;
	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/** The page's capture now, `null` while there is none. */
export const currentDictation = (): Dictation | null => current;

/** The page's capture, `null` while there is none, rendering again as it changes. */
export const useDictationState = (): Dictation | null => useSyncExternalStore(subscribe, currentDictation, currentDictation);

type Send = (msg: ClientMsg) => void;

/** Opens the microphone for `target`, replacing how the last capture ended; does nothing while one holds it. */
export function startDictation(target: DictationTarget, send: Send): void {
	if (capturing(current)) return;
	const captureId = crypto.randomUUID();
	send({ t: "dictation-start", captureId, cwd: target.cwd });
	set({ phase: "starting", captureId, target, preview: "", processing: null });
}

/** Stops the capture: a recording one ends with what was said, a starting one ends with nothing. */
export function stopDictation(send: Send): void {
	if (!stoppable(current)) return;
	send({ t: "dictation-stop", captureId: current.captureId });
	if (current.phase === "starting") set({ ...current, phase: "cancelling" });
}

/** Stops the capture of the composer of `draftKey`, keeping what it heard, when the page's capture is its. */
export function stopDictationFor(draftKey: string, send: Send): void {
	if (current?.target.draftKey === draftKey) stopDictation(send);
}

/** Closes the microphone at once and keeps nothing it heard. */
export function discardDictation(send: Send): void {
	if (capturing(current)) send({ t: "dictation-discard", captureId: current.captureId });
	set(null);
}

/** Forgets how the last capture ended. */
export const dismissDictation = (): void => set(null);

/** Puts what a failed capture heard before its failure in the draft. */
export function keepPreview(): void {
	if (current?.phase !== "failed") return;
	const { draftKey, text, start, end } = current.target;
	replaceInComposer(draftKey, text, { start, end, text: current.preview });
	set(null);
}

/** `dictation` after `event` of its capture; a cancelling capture waits only for its end. */
function withEvent(dictation: Capturing, event: Exclude<DictationEvent, { kind: "end" }>): Dictation | null {
	if (dictation.phase === "cancelling") return dictation;
	switch (event.kind) {
		case "off": {
			const { captureId, target } = dictation;
			return { phase: "off", captureId, target, settings: event.settings };
		}
		case "processing":
			return { ...dictation, processing: event.processing };
		case "preview":
			return { ...dictation, preview: event.text };
		case "state":
			return { ...dictation, phase: event.state === "recording" ? "listening" : event.state };
		default: {
			const unhandled: never = event;
			return unhandled;
		}
	}
}

/** A `dictation` event from the server; one for a capture the page no longer holds changes nothing. */
export function applyDictationMessage({ captureId, event }: Extract<ServerMsg, { t: "dictation" }>): void {
	if (!capturing(current) || current.captureId !== captureId) return;
	if (event.kind !== "end") return set(withEvent(current, event));
	const { target, preview } = current;
	if (current.phase === "cancelling") return set(null);
	if (event.error !== null) return set({ phase: "failed", captureId, target, error: event.error, preview: event.text || preview });
	if (event.text.trim() === "") return set({ phase: "empty", captureId, target });
	replaceInComposer(target.draftKey, target.text, { start: target.start, end: target.end, text: event.text });
	set(null);
}

/** The socket closed, and the server closed the microphone it held for it. */
export function dictationDisconnected(): void {
	if (!capturing(current)) return;
	const { captureId, target, preview } = current;
	set(current.phase === "cancelling" ? null : { phase: "failed", captureId, target, error: "Lost the connection to the server.", preview });
}

/** What a button of the status row does: each maps to one store function, or to a new capture for `retry`. */
export type DictationAction = "cancel" | "stop" | "discard" | "keep" | "retry" | "dismiss";

/** The status row of a capture: its status line, the text under it, how it reads, and its buttons in order. */
export interface DictationRow {
	status: string;
	detail: string | null;
	tone: "muted" | "active" | "error";
	actions: DictationAction[];
}

/** The status row `dictation` shows above its composer's text field; `off` shows the setup popover instead. */
export function rowOf(dictation: Dictation): DictationRow | null {
	switch (dictation.phase) {
		case "off":
			return null;
		case "starting":
			return { status: "Preparing dictation…", detail: null, tone: "muted", actions: ["cancel"] };
		case "cancelling":
			return { status: "Cancelling…", detail: null, tone: "muted", actions: ["discard"] };
		case "listening":
			return {
				status: dictation.processing ? `Listening on this computer · transcribed by ${processingText(dictation.processing)}` : "Listening on this computer",
				detail: dictation.preview || "Speak now. Text appears here when available.",
				tone: "active",
				actions: ["stop", "discard"],
			};
		case "transcribing":
			return { status: "Transcribing…", detail: dictation.preview || null, tone: "active", actions: ["discard"] };
		case "empty":
			return {
				status: "No speech detected",
				detail: "Nothing was loud enough to count as speech. Speak closer to the microphone, or raise its input level in your sound settings.",
				tone: "muted",
				actions: ["retry", "dismiss"],
			};
		case "failed":
			return {
				status: dictation.error,
				detail: dictation.preview || null,
				tone: "error",
				actions: dictation.preview === "" ? ["retry", "dismiss"] : ["keep", "retry", "dismiss"],
			};
		default: {
			const unhandled: never = dictation;
			return unhandled;
		}
	}
}
