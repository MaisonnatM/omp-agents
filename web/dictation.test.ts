import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { DictationEvent, DictationSettings } from "../src/shared/dictation";
import type { ClientMsg } from "../src/shared/protocol";
import {
	applyDictationMessage,
	currentDictation,
	type DictationTarget,
	dictationDisconnected,
	discardDictation,
	dismissDictation,
	keepPreview,
	rowOf,
	startDictation,
	stopDictation,
} from "./dictation";

// The drafts a capture lands in when its composer is not mounted live in localStorage, which bun has none of.
const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) };
Object.assign(globalThis, { localStorage: storage });
afterAll(() => Reflect.deleteProperty(globalThis, "localStorage"));

const draft = (key: string): string | null => {
	const kept: Record<string, { text: string }> = JSON.parse(memory.get("omp-agents.composer-drafts") ?? "{}");
	return kept[key]?.text ?? null;
};

const target: DictationTarget = { draftKey: "live/a", cwd: "/app", text: "fix  bug", start: 4, end: 4 };
const settings: DictationSettings = { enabled: false, enabledBy: "default", language: "en", processing: { kind: "local", model: "Parakeet TDT v3", size: "~680 MB" } };

let sent: ClientMsg[] = [];
const send = (msg: ClientMsg): void => {
	sent.push(msg);
};

/** Starts a capture for `target` and answers the id the server would get. */
function start(): string {
	startDictation(target, send);
	const msg = sent.at(-1);
	if (msg?.t !== "dictation-start") throw new Error("no dictation-start sent");
	return msg.captureId;
}

const event = (captureId: string, ...events: DictationEvent[]): void => {
	for (const each of events) applyDictationMessage({ t: "dictation", captureId, event: each });
};

beforeEach(() => {
	discardDictation(() => {});
	sent = [];
	memory.clear();
});

describe("the page's capture", () => {
	test("starts with the composer's directory, listens, and lands its text at the selection without sending it", () => {
		const id = start();
		expect(sent).toEqual([{ t: "dictation-start", captureId: id, cwd: "/app" }]);
		event(id, { kind: "processing", processing: settings.processing }, { kind: "state", state: "recording" }, { kind: "preview", text: "the" });
		expect(currentDictation()).toMatchObject({ phase: "listening", preview: "the", processing: settings.processing });
		event(id, { kind: "state", state: "transcribing" });
		expect(currentDictation()?.phase).toBe("transcribing");
		event(id, { kind: "end", text: "the", error: null });
		expect(currentDictation()).toBeNull();
		expect(draft("live/a")).toBe("fix the bug");
		expect(sent.map(msg => msg.t)).toEqual(["dictation-start"]);
	});

	test("starts no second capture while one holds the microphone, and ignores events of another capture", () => {
		const id = start();
		startDictation({ ...target, draftKey: "live/b" }, send);
		expect(sent).toHaveLength(1);
		event("other", { kind: "end", text: "elsewhere", error: null });
		expect(currentDictation()).toMatchObject({ phase: "starting", captureId: id });
	});

	test("a stop while starting cancels it: it shows no recording that comes after, stops once, and its end lands nothing and says nothing", () => {
		const id = start();
		stopDictation(send);
		expect(sent.at(-1)).toEqual({ t: "dictation-stop", captureId: id });
		event(id, { kind: "state", state: "recording" }, { kind: "preview", text: "late" });
		expect(currentDictation()).toMatchObject({ phase: "cancelling", preview: "" });
		stopDictation(send);
		expect(sent).toHaveLength(2);
		event(id, { kind: "end", text: "late words", error: null });
		expect(currentDictation()).toBeNull();
		expect(draft("live/a")).toBeNull();
	});

	test("a capture that transcribes is past stopping, and only Discard ends it", () => {
		const id = start();
		event(id, { kind: "state", state: "recording" }, { kind: "state", state: "transcribing" });
		stopDictation(send);
		expect(sent).toHaveLength(1);
		discardDictation(send);
		expect(sent.at(-1)).toEqual({ t: "dictation-discard", captureId: id });
		event(id, { kind: "end", text: "dropped", error: null });
		expect(currentDictation()).toBeNull();
		expect(draft("live/a")).toBeNull();
	});

	test("dictation off in the directory keeps its settings for the setup popover, and the end after it changes nothing", () => {
		const id = start();
		event(id, { kind: "off", settings }, { kind: "end", text: "", error: "Dictation is off" });
		expect(currentDictation()).toEqual({ phase: "off", captureId: id, target, settings });
		dismissDictation();
		const cancelled = start();
		stopDictation(send);
		event(cancelled, { kind: "off", settings }, { kind: "end", text: "", error: "Dictation is off" });
		expect(currentDictation()).toBeNull();
	});

	test("an end that heard nothing is empty; a failed one keeps what it heard, which Use preview lands", () => {
		const quiet = start();
		event(quiet, { kind: "end", text: "  ", error: null });
		expect(currentDictation()).toEqual({ phase: "empty", captureId: quiet, target });
		const failing = start();
		event(failing, { kind: "preview", text: "the" }, { kind: "end", text: "", error: "The model failed" });
		expect(currentDictation()).toEqual({ phase: "failed", captureId: failing, target, error: "The model failed", preview: "the" });
		keepPreview();
		expect(currentDictation()).toBeNull();
		expect(draft("live/a")).toBe("fix the bug");
	});

	test("a closed socket fails the capture with what it heard, or forgets a cancelled one", () => {
		const id = start();
		event(id, { kind: "preview", text: "half" });
		dictationDisconnected();
		expect(currentDictation()).toMatchObject({ phase: "failed", error: "Lost the connection to the server.", preview: "half" });
		start();
		stopDictation(send);
		dictationDisconnected();
		expect(currentDictation()).toBeNull();
	});
});

describe("rowOf", () => {
	const capturing = { captureId: "c", target, preview: "", processing: null };
	const row = rowOf;

	test("a capture under way offers Cancel, then Stop and Discard, then only Discard", () => {
		expect(row({ ...capturing, phase: "starting" })).toEqual({ status: "Preparing dictation…", detail: null, tone: "muted", actions: ["cancel"] });
		expect(row({ ...capturing, phase: "listening" })).toEqual({
			status: "Listening on this computer",
			detail: "Speak now. Text appears here when available.",
			tone: "active",
			actions: ["stop", "discard"],
		});
		expect(row({ ...capturing, phase: "listening", preview: "the", processing: settings.processing })).toMatchObject({
			status: "Listening on this computer · transcribed by Parakeet TDT v3 on this computer",
			detail: "the",
		});
		expect(row({ ...capturing, phase: "transcribing" })).toEqual({ status: "Transcribing…", detail: null, tone: "active", actions: ["discard"] });
	});

	test("an ended capture offers Try again and Dismiss, and Use preview when it heard something; off shows no row", () => {
		expect(row({ phase: "empty", captureId: "c", target })).toEqual({ status: "No speech detected", detail: null, tone: "muted", actions: ["retry", "dismiss"] });
		expect(row({ phase: "failed", captureId: "c", target, error: "Busy", preview: "" })?.actions).toEqual(["retry", "dismiss"]);
		expect(row({ phase: "failed", captureId: "c", target, error: "Busy", preview: "the" })).toEqual({ status: "Busy", detail: "the", tone: "error", actions: ["keep", "retry", "dismiss"] });
		expect(row({ phase: "off", captureId: "c", target, settings })).toBeNull();
	});
});
