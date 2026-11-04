import { expect, test } from "bun:test";
import { CACHE_STEP, GC_PHASES, parseCleanupRequest, PREVIEW_SOURCES } from "./storage";

test("a preview never accepts an apply phase, and applies exactly one known phase", () => {
	for (const source of PREVIEW_SOURCES) expect(parseCleanupRequest({ action: "preview", source })).toEqual({ ok: { action: "preview", source } });
	for (const step of [...GC_PHASES, CACHE_STEP]) expect(parseCleanupRequest({ action: "apply", step })).toEqual({ ok: { action: "apply", step } });
	for (const raw of [null, [], {}, { action: "preview" }, { action: "preview", source: "stale" }, { action: "apply", step: "all" }, { action: "apply", step: "--help" }, { action: "apply", step: "sandboxes" }]) expect(parseCleanupRequest(raw)).toBeNull();
});

test("sandbox requests have bounded, deduplicated paths", () => {
	expect(parseCleanupRequest({ action: "apply", step: "sandboxes", sandboxes: ["/tmp/a", "/tmp/a"] })).toEqual({ ok: { action: "apply", step: "sandboxes", sandboxes: ["/tmp/a"] } });
	expect(parseCleanupRequest({ action: "apply", step: "changedSandboxes", sandboxes: ["/tmp/a"] })).toEqual({ ok: { action: "apply", step: "changedSandboxes", sandboxes: ["/tmp/a"] } });
	expect(parseCleanupRequest({ action: "apply", step: "changedSandboxes" })).toBeNull();
	for (const sandboxes of [[""], [false], ["a".repeat(4096)], Array(201).fill("/tmp/a")]) expect(parseCleanupRequest({ action: "apply", step: "sandboxes", sandboxes })).toBeNull();
});
