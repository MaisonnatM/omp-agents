import { describe, expect, test } from "bun:test";
import { blockedByWorkspace, type DictationSettings, type DictationSource, processingText } from "./dictation";

const settings = (enabled: boolean, enabledBy: DictationSource): DictationSettings => ({
	enabled,
	enabledBy,
	language: "en",
	processing: { kind: "local", model: "Parakeet TDT v3", size: "~680 MB" },
});

describe("blockedByWorkspace", () => {
	test("only a workspace's config or the environment keeping dictation off blocks turning it on for the user", () => {
		expect(blockedByWorkspace(settings(false, "project"))).toBe(true);
		expect(blockedByWorkspace(settings(false, "env"))).toBe(true);
		for (const source of ["global", "default", "runtime", "overlay"] as const) expect(blockedByWorkspace(settings(false, source))).toBe(false);
		expect(blockedByWorkspace(settings(true, "project"))).toBe(false);
	});
});

describe("processingText", () => {
	test("says where speech goes for each kind of model", () => {
		expect(processingText({ kind: "local", model: "Parakeet TDT v3", size: "~680 MB" })).toBe("Parakeet TDT v3 on this computer");
		expect(processingText({ kind: "cloud", model: "openai/whisper-1" })).toBe("openai/whisper-1, sent to its provider");
		expect(processingText({ kind: "unsupported", api: "openai-completions" })).toBe("a model omp cannot dictate with (openai-completions)");
	});
});
