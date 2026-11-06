import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { tmpdir } from "node:os";
import type { DictationEvent } from "../shared/dictation";
import { type DictationCapture, startDictation } from "./dictation";
import * as models from "./models";
import type { OpenRegistry } from "./models";
import type { DictationFrame } from "./module-types/speech";
import { modelResolver, modelRoles, rpcDictation, sttSettings } from "./modules";

/** What omp's bridge was asked, and how it answers: `start` as `starts` says, and no frame unless a test sends one. */
let bridge: { output: (frame: DictationFrame) => void; calls: string[]; starts: () => Promise<void> };
let closed: number;

/** omp's bridge, which the capture builds with `new`, replaced by one that answers as {@link bridge} says. */
class FakeBridge {
	constructor(_session: null, output: (frame: DictationFrame) => void) {
		bridge.output = output;
	}
	start(captureId: string): Promise<void> {
		bridge.calls.push(`start ${captureId}`);
		return bridge.starts();
	}
	stop(): Promise<{ text: string }> {
		bridge.calls.push("stop");
		return new Promise(() => {});
	}
	dispose(): void {
		bridge.calls.push("dispose");
	}
}

beforeEach(() => {
	closed = 0;
	const registry = { settings: {}, registry: {}, close: () => void (closed += 1) } as unknown as OpenRegistry;
	spyOn(models, "openRegistry").mockResolvedValue(registry);
	spyOn(sttSettings.cfgSttEnabled, "get").mockReturnValue(true);
	spyOn(modelRoles, "roleCandidatePool").mockReturnValue([]);
	spyOn(modelResolver, "resolveRoleChain").mockReturnValue([]);
	bridge = { output: () => {}, calls: [], starts: () => new Promise(() => {}) };
	// The capture builds the bridge with `new`, which takes the object a plain function returns.
	const bridges = rpcDictation as unknown as { RpcDictationBridge: (session: null, output: (frame: DictationFrame) => void) => FakeBridge };
	spyOn(bridges, "RpcDictationBridge").mockImplementation((session, output) => new FakeBridge(session, output));
});

afterEach(() => mock.restore());

/** Starts a capture in a real directory and waits until the bridge has it. */
async function capture(): Promise<{ events: DictationEvent[]; capture: DictationCapture }> {
	const events: DictationEvent[] = [];
	const started = startDictation(tmpdir(), "c1", event => events.push(event));
	for (let tries = 0; bridge.calls.length === 0 && tries < 100; tries += 1) await Bun.sleep(1);
	return { events, capture: started };
}

const ends = (events: DictationEvent[]): DictationEvent[] => events.filter(event => event.kind === "end");

describe("startDictation", () => {
	test("a dispose ends the capture at once, whether or not the bridge sends its end, and only once", async () => {
		const { events, capture: started } = await capture();
		started.dispose();
		expect(bridge.calls).toEqual(["start c1", "dispose"]);
		expect(ends(events)).toEqual([{ kind: "end", text: "", error: null }]);
		expect(closed).toBe(1);
		bridge.output({ type: "dictation_end", captureId: "c1", text: "late", error: undefined });
		bridge.output({ type: "dictation_state", captureId: "c1", state: "recording" });
		expect(ends(events)).toHaveLength(1);
		expect(events.at(-1)?.kind).toBe("end");
	});

	test("a bridge whose start fails without an end frame ends the capture with its error", async () => {
		bridge.starts = () => Promise.reject(new Error("No microphone"));
		const { events } = await capture();
		await Bun.sleep(0);
		expect(ends(events)).toEqual([{ kind: "end", text: "", error: "No microphone" }]);
		expect(closed).toBe(1);
	});

	test("a stop before the microphone opens ends the capture with nothing, and opens no bridge", async () => {
		const events: DictationEvent[] = [];
		startDictation(tmpdir(), "c1", event => events.push(event)).stop();
		expect(ends(events)).toEqual([{ kind: "end", text: "", error: null }]);
		await Bun.sleep(5);
		expect(bridge.calls).toEqual([]);
	});
});
