import { expect, test } from "bun:test";
import { parseComparisonRecord, type ComparisonRecord, type VariantRecord } from "./comparison-records";

function record(): ComparisonRecord {
	return {
		version: 2,
		spec: { cwd: "/repo", prompt: "Build it", images: [], base: "HEAD", model: null, thinking: null, skill: null, variants: [{ model: null, thinking: null }, { model: null, thinking: null }] },
		snapshot: {
			id: "comparison", createdAt: 1, prompt: "Build it", sourceCwd: "/repo", repository: "/repo/.git", base: "HEAD", baseSha: "a".repeat(40), winner: null,
			variants: [1, 2].map<VariantRecord>(index => ({
				id: `v${index}`, instanceId: `i${index}`, sessionId: `s${index}`, sessionIds: [`s${index}`],
				cwd: `/variant-${index}`, checkout: `/variant-${index}`, branch: `variant-${index}`,
				model: null, thinkingLevel: "high", lifecycle: { kind: "running" }, screenshot: null, screenshotError: null,
			})),
		},
		owned: {}, instances: { i1: "v1", i2: "v2" }, receipts: {},
	};
}

test("the persisted record preserves typed lifecycle and actual settings", () => {
	const value = record();
	value.snapshot.variants[0]!.model = { provider: "actual", id: "chosen" };
	expect(parseComparisonRecord(JSON.parse(JSON.stringify(value)), "comparison")).toEqual(value);
});

test("record guards reject invalid lifecycle payloads, duplicate identities, and inconsistent ownership", () => {
	const value = record();
	const variants = value.snapshot.variants;
	expect(parseComparisonRecord({ ...value, snapshot: { ...value.snapshot, variants: [{ ...variants[0], lifecycle: { kind: "uncertain" } }, variants[1]] } }, "comparison")).toBeNull();
	const identityKeys: ("id" | "instanceId" | "checkout" | "branch" | "sessionId")[] = ["id", "instanceId", "checkout", "branch", "sessionId"];
	for (const key of identityKeys) {
		const duplicate = { ...variants[1], [key]: variants[0]![key] };
		expect(parseComparisonRecord({ ...value, snapshot: { ...value.snapshot, variants: [variants[0], duplicate] } }, "comparison")).toBeNull();
	}
	expect(parseComparisonRecord({ ...value, instances: { i1: "v2", i2: "v2" } }, "comparison")).toBeNull();
	expect(parseComparisonRecord({ ...value, owned: { v1: { repository: "/foreign/.git", path: "/variant-1", branch: "variant-1", identity: "1:2" } } }, "comparison")).toBeNull();
	expect(parseComparisonRecord({ ...value, snapshot: { ...value.snapshot, winner: "missing" } }, "comparison")).toBeNull();
	expect(parseComparisonRecord({ ...value, receipts: { '["foreign-instance","call"]': { sequence: 1, src: "/media", caption: "wrong publisher", publishedAt: 1 } } }, "comparison")).toBeNull();
});

test("valid legacy records convert once to the lifecycle schema without retaining redundant fields", () => {
	const value = record();
	const variants = value.snapshot.variants.map((v, index) => ({
		id: v.id, ordinal: index + 1, instanceId: v.instanceId, sessionId: v.sessionId, sessionIds: v.sessionIds,
		cwd: v.cwd, checkout: v.checkout, branch: v.branch, model: v.model, thinking: v.thinkingLevel,
		start: { kind: "registered" }, firstPrompt: { kind: "admitted" }, stop: { kind: "not-requested" }, cleanup: { kind: "pending" },
		screenshot: v.screenshot, screenshotError: v.screenshotError,
	}));
	const legacy = {
		version: 1, spec: value.spec, keeperDirectory: "/keepers", owned: {}, receipts: {}, cleanupIntent: null,
		instances: { i1: { variant: "v1", directory: "/keepers" }, i2: { variant: "v2", directory: "/keepers" } },
		snapshot: { ...value.snapshot, variants, owner: { kind: "local" }, cleanup: { kind: "not-selected" }, error: null },
	};
	expect(parseComparisonRecord(legacy, "comparison")).toEqual({
		...value,
		snapshot: { ...value.snapshot, variants: value.snapshot.variants.map(v => ({ ...v, model: null, thinkingLevel: null })) },
	});
	expect(parseComparisonRecord({ ...legacy, snapshot: { ...legacy.snapshot, cleanup: { kind: "ready", review: null } } }, "comparison")).toBeNull();
	expect(parseComparisonRecord({ ...legacy, snapshot: { ...legacy.snapshot, variants: [{ ...variants[0], cleanup: { kind: "removed" } }, variants[1]] } }, "comparison")).toBeNull();
	const blocked = { ...variants[0], stop: { kind: "blocked", reason: "A keeper is still alive." }, cleanup: { kind: "blocked", reasons: ["A keeper is still alive."] } };
	expect(parseComparisonRecord({ ...legacy, snapshot: { ...legacy.snapshot, variants: [blocked, variants[1]] } }, "comparison")?.snapshot.variants[0]?.lifecycle)
		.toEqual({ kind: "stop-blocked", reason: "A keeper is still alive." });
});
