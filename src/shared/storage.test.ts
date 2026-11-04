import { expect, test } from "bun:test";
import { CACHE_STEP, GC_PHASES, parseCleanupRequest } from "./storage";

test("a preview never accepts an apply phase, and applies exactly one known phase", () => {
	expect(parseCleanupRequest({ action: "preview" })).toEqual({ ok: { action: "preview" } });
	expect(parseCleanupRequest({ action: "preview", step: "sandboxes" })).toEqual({ ok: { action: "preview", step: "sandboxes" } });
	expect(parseCleanupRequest({ action: "preview", step: "packageCaches" })).toEqual({ ok: { action: "preview", step: "packageCaches" } });
	for (const step of [...GC_PHASES, CACHE_STEP]) expect(parseCleanupRequest({ action: "apply", step })).toEqual({ ok: { action: "apply", step } });
	for (const raw of [null, [], {}, { action: "apply", step: "all" }, { action: "apply", step: "--help" }, { action: "preview", step: "blobs" }, { action: "apply", step: "sandboxes" }]) expect(parseCleanupRequest(raw)).toBeNull();
});

test("sandbox requests have bounded, deduplicated paths", () => {
	expect(parseCleanupRequest({ action: "apply", step: "sandboxes", sandboxes: ["/tmp/a", "/tmp/a"] })).toEqual({ ok: { action: "apply", step: "sandboxes", sandboxes: ["/tmp/a"] } });
	expect(parseCleanupRequest({ action: "apply", step: "changedSandboxes", sandboxes: ["/tmp/a"] })).toEqual({ ok: { action: "apply", step: "changedSandboxes", sandboxes: ["/tmp/a"] } });
	expect(parseCleanupRequest({ action: "apply", step: "changedSandboxes" })).toBeNull();
	for (const sandboxes of [[""], [false], ["a".repeat(4096)], Array(201).fill("/tmp/a")]) expect(parseCleanupRequest({ action: "apply", step: "sandboxes", sandboxes })).toBeNull();
});
