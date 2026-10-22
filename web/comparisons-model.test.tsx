import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComparisonSnapshot, ComparisonVariant, VariantLifecycle } from "../src/shared/comparisons";
import { cleanupRemaining, EMPTY_SCREENSHOT, screenshotPreview } from "./comparisons-model";
import { ComparisonsPage } from "./components/comparisons-page";
import { CleanupLosses } from "./components/comparison-dialogs";
import { VariantCard } from "./components/comparison-variant-card";
import { DashboardActionsContext, type DashboardActions } from "./components/dashboard-context";
import { initialState, reduce } from "./dashboard-state";
import { hashForComparisons, routeFromHash } from "./routing";

const variant = (number: number): ComparisonVariant => ({
	id: `variant-${number}`,
	instanceId: `instance-${number}`,
	sessionId: `session-${number}`,
	sessionIds: [`session-${number}`],
	cwd: `/repo-variant-${number}/web`,
	checkout: `/repo-variant-${number}`,
	branch: `design-${number}`,
	selection: { model: number === 5 ? { provider: "anthropic", id: "requested-model" } : null, thinking: number === 5 ? "low" : null },
	model: number === 5 ? { provider: "openai", id: "gpt-5" } : null,
	thinkingLevel: number === 5 ? "high" : null,
	lifecycle: { kind: "running" },
	screenshot: null,
	screenshotError: null,
});
const comparison: ComparisonSnapshot = {
	id: "comparison-1",
	createdAt: 1,
	prompt: "Compare five navigation designs",
	sourceCwd: "/repo/web",
	repository: "/repo",
	base: "main",
	baseSha: "a".repeat(40),
	owner: { kind: "local" },
	variants: Array.from({ length: 5 }, (_, index) => variant(index + 1)),
	winner: null,
	cleanup: { kind: "not-selected" },
};
const actions: DashboardActions = {
	send() {}, request: async () => {}, open() {}, focus() {}, start() {}, dismissStart() {}, openNewSession() {}, changeTodo() {}, end() {}, openFile() {}, openNewTicket() {}, workspaceSettings: () => null,
};

const oldImage = { sequence: 1, src: "/api/media?path=first.png", caption: "First design", publishedAt: 1 };
const nextImage = { sequence: 2, src: "/api/media?path=second.png", caption: "Revised design", publishedAt: 2 };

test("a newer screenshot retains the old image until it loads, and a stale load cannot replace it", () => {
	const loaded = screenshotPreview(screenshotPreview(EMPTY_SCREENSHOT, { kind: "publish", screenshot: oldImage }), { kind: "loaded", screenshot: oldImage });
	const updating = screenshotPreview(loaded, { kind: "publish", screenshot: nextImage });
	expect(updating).toEqual({ shown: oldImage, requested: nextImage, failed: false });
	expect(screenshotPreview(updating, { kind: "loaded", screenshot: oldImage })).toEqual({ shown: oldImage, requested: nextImage, failed: false });
	const revised = screenshotPreview(updating, { kind: "loaded", screenshot: nextImage });
	expect(revised).toEqual({ shown: nextImage, requested: nextImage, failed: false });
	expect(screenshotPreview(revised, { kind: "publish", screenshot: oldImage })).toEqual({ shown: nextImage, requested: nextImage, failed: false });
});

test("a failed latest screenshot retains the last real image and records failure", () => {
	const loaded = screenshotPreview(screenshotPreview(EMPTY_SCREENSHOT, { kind: "publish", screenshot: oldImage }), { kind: "loaded", screenshot: oldImage });
	const failed = screenshotPreview(screenshotPreview(loaded, { kind: "publish", screenshot: nextImage }), { kind: "failed", screenshot: nextImage });
	expect(failed).toEqual({ shown: oldImage, requested: nextImage, failed: true });
});

test("comparison snapshots preserve five members and reopen independently of ordinary pane limits", () => {
	const route = routeFromHash(hashForComparisons("comparison-1"));
	expect(route).toEqual({ kind: "page", page: { kind: "comparisons", id: "comparison-1" } });
	const state = reduce(initialState(route), { t: "comparisons", comparisons: [comparison] });
	expect(state.comparisons?.[0]?.variants.map(row => row.branch)).toEqual(["design-1", "design-2", "design-3", "design-4", "design-5"]);
	expect(state.layout.panes).toEqual([]);
	const disconnected = reduce(state, { t: "connected", connected: false });
	expect(disconnected.comparisons?.[0]?.variants[4]?.model).toEqual({ provider: "openai", id: "gpt-5" });
});

test("the comparison renders every member and saved actual model after the live host leaves", () => {
	const html = renderToStaticMarkup(<DashboardActionsContext value={actions}><ComparisonsPage id="comparison-1" comparisons={[comparison]} hosts={[]} connected /></DashboardActionsContext>);
	expect(html.match(/<article\b/g)?.length).toBe(5);
	expect(html.match(/href="#session\/session-\d"/g)).toEqual([
		'href="#session/session-1"', 'href="#session/session-2"', 'href="#session/session-3"', 'href="#session/session-4"', 'href="#session/session-5"',
	]);
	expect(html).toContain("openai/gpt-5");
	expect(html).toContain("design-5");
	expect(html).toContain("high");
	expect(html.match(/>Running</g)?.length).toBe(5);
});

test("cleanup counts preserved and blocked losers as remaining, never the winner", () => {
	const selected: ComparisonSnapshot = {
		...comparison,
		winner: "variant-1",
		variants: comparison.variants.map((row, index): ComparisonVariant => ({
			...row,
			lifecycle: index === 1 ? { kind: "removed" }
				: index === 2 ? { kind: "preserved" }
				: index === 3 ? { kind: "cleanup-blocked", reasons: ["Locked"] }
				: { kind: "stopped" },
		})),
	};
	expect(cleanupRemaining(selected)).toBe(3);
	expect(cleanupRemaining({ ...selected, variants: selected.variants.map((row): ComparisonVariant => ({ ...row, lifecycle: { kind: "removed" } })) })).toBe(0);
});

test("the loss review exposes exact tracked, untracked and ignored paths and hard blockers", () => {
	const html = renderToStaticMarkup(<CleanupLosses review={{ id: "review-1", createdAt: 1, rows: [{ variantId: "variant-2", path: "/repo-variant-2", branch: "design-2", tracked: ["src/app.tsx"], untracked: ["draft.png"], ignored: ["node_modules/cache"], blockers: [{ code: "locked", message: "Locked by another process" }], removed: false }] }} />);
	for (const path of ["/repo-variant-2", "src/app.tsx", "draft.png", "node_modules/cache", "Locked by another process"]) expect(html).toContain(path);
});

test("the comparison list reopens a durable group and malformed route escapes do not become pane ids", () => {
	const html = renderToStaticMarkup(<ComparisonsPage id={null} comparisons={[comparison]} hosts={[]} connected={false} />);
	expect(html).toContain('href="#comparisons/comparison-1"');
	expect(routeFromHash("#comparisons/%zz")).toEqual({ kind: "page", page: { kind: "comparisons", id: null } });
});

test("a variant presents one lifecycle with its failure or safety detail", () => {
	const cases: [VariantLifecycle, string, string | null][] = [
		[{ kind: "registered" }, "Registered, waiting to send", null],
		[{ kind: "prompt-attempted" }, "Sending first prompt", null],
		[{ kind: "failed", error: "Provider unavailable" }, "Start failed", "Provider unavailable"],
		[{ kind: "uncertain", reason: "Acknowledgement lost." }, "First prompt uncertain", "The first prompt will not be sent again automatically."],
		[{ kind: "stop-blocked", reason: "Keeper still alive" }, "Stop blocked", "Keeper still alive"],
		[{ kind: "cleanup-blocked", reasons: ["Worktree locked"] }, "Stopped, removal blocked", "Worktree locked"],
		[{ kind: "removed" }, "Stopped, checkout removed", null],
	];
	for (const [lifecycle, label, detail] of cases) {
		const html = renderToStaticMarkup(
			<VariantCard variant={{ ...variant(5), lifecycle }} number={2} host={undefined} winner={false} canSelect={false} onSelect={() => {}} />,
		);
		expect(html).toContain(label);
		if (detail) expect(html).toContain(detail);
		expect(html).toContain("Variant 2");
		expect(html).toContain("openai/gpt-5");
		expect(html).toContain("Requested model");
		expect(html).toContain("Actual model");
		expect(html).not.toContain("First prompt </dt>");
	}
});

test("the comparisons list links directly to its dedicated composer", () => {
	const html = renderToStaticMarkup(<ComparisonsPage id={null} comparisons={[]} hosts={[]} connected />);
	expect(html).toContain('href="#new-variants"');
	expect(html).toContain("New comparison");
	expect(html).toContain("No design comparisons yet.");
});

test("requested settings do not become actual settings when a launch fails before registration", () => {
	const failed: ComparisonVariant = {
		...variant(5),
		sessionId: null,
		sessionIds: [],
		model: null,
		thinkingLevel: null,
		lifecycle: { kind: "failed", error: "Could not register" },
	};
	const html = renderToStaticMarkup(
		<VariantCard variant={failed} number={1} host={undefined} winner={false} canSelect={false} onSelect={() => {}} />,
	);
	expect(html).toContain("anthropic/requested-model");
	expect(html).toContain("low");
	expect(html).toContain("Not reported");
	expect(html).toContain("Could not register");
	expect(html).not.toContain("openai/gpt-5");
});
