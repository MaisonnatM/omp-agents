import { describe, expect, test } from "bun:test";
import type { SessionBranch } from "../src/shared/sessions";
import { offeredPrompt, type OpenPullRequestHost, type Press, pressAfter } from "./open-pull-request";

const onBranch = (fields: Partial<SessionBranch> = {}): SessionBranch => ({ name: "me/fix-login", linked: true, defaultBranch: "main", pullRequest: null, ...fields });
const host = (fields: Partial<OpenPullRequestHost> = {}): OpenPullRequestHost => ({
	sessionId: "s1",
	branch: onBranch(),
	control: { phase: "live", readOnly: false },
	status: "idle",
	queue: { steering: [], followUp: [] },
	...fields,
});
const PROMPT = offeredPrompt(host()) ?? "";
const pressed: Press = { phase: "flight", prompt: PROMPT, answered: false };
const answered: Press = { phase: "flight", prompt: PROMPT, answered: true };
const earlier = "an earlier prompt";
const steer = "use the staging remote";
const followUp = { steering: [], followUp: [PROMPT] };

/** The phase after each step, carrying the press from step to step as the hook does; `answer` marks the send answered first. */
function phases(steps: { host: OpenPullRequestHost; last: string | null; answer?: true }[], press: Press | null = pressed): (Press["phase"] | null)[] {
	return steps.map(step => {
		const from = step.answer && press?.phase === "flight" ? { ...press, answered: true } : press;
		press = pressAfter(PROMPT, step.host, step.last, from);
		return press?.phase ?? null;
	});
}

test("offers Open PR only to a session the dashboard can prompt, on a branch other than the default one that heads no pull request", () => {
	const offered = [
		host(),
		host({ branch: null }),
		host({ branch: onBranch({ name: "main" }) }),
		host({ branch: onBranch({ defaultBranch: null }) }),
		host({ branch: onBranch({ pullRequest: { owner: "acme", repo: "webapp", number: 7 } }) }),
		host({ control: { phase: "live", readOnly: true } }),
		host({ control: { phase: "reconnecting", reason: "Relay gone" } }),
	].map(row => offeredPrompt(row) !== null);
	expect(offered).toEqual([true, false, false, false, false, false, false]);
});

test("the prompt passes the branch and base to git and gh as quoted shell words", () => {
	const prompt = offeredPrompt(host({ branch: onBranch({ name: "me/$(x);'y", defaultBranch: "trunk" }) })) ?? "";
	expect(prompt).toContain("`me/$(x);'y` into `trunk`");
	expect(prompt).toContain("git diff 'origin/trunk'...HEAD");
	expect(prompt).toContain("git push -u origin 'me/$(x);'\\''y'");
	expect(prompt).toContain("gh pr create --base 'trunk' --head 'me/$(x);'\\''y'");
});

describe("pressAfter", () => {
	test("keeps a press in flight until the session shows it took the prompt, or the server answered and no turn runs", () => {
		expect([
			pressAfter(PROMPT, host(), null, pressed)?.phase,
			pressAfter(PROMPT, host({ status: "working" }), earlier, answered)?.phase,
			pressAfter(PROMPT, host({ status: "needs-input" }), earlier, answered)?.phase,
			pressAfter(PROMPT, host({ status: "unknown" }), earlier, answered)?.phase,
			pressAfter(PROMPT, host(), earlier, answered),
		]).toEqual(["flight", "flight", "flight", "flight", null]);
	});

	test("an idle click stays seen through its turn, steers sent during it, and a question, and releases once the session is next idle", () => {
		expect(
			phases([
				{ host: host({ status: "working" }), last: PROMPT, answer: true },
				{ host: host({ status: "working" }), last: steer },
				{ host: host({ status: "needs-input" }), last: steer },
				{ host: host({ status: "unknown" }), last: steer },
				{ host: host({ status: "working", queue: { steering: [], followUp: ["and then the docs"] } }), last: steer },
				{ host: host({ status: "idle" }), last: steer },
			]),
		).toEqual(["seen", "seen", "seen", "seen", "seen", null]);
	});

	test("a follow-up is seen from the queue on, stays seen when taken back out while a turn runs, and releases once the session is next idle", () => {
		expect(
			phases([
				{ host: host({ status: "working", queue: followUp }), last: earlier },
				{ host: host({ status: "working" }), last: earlier },
				{ host: host({ status: "idle" }), last: earlier },
			]),
		).toEqual(["seen", "seen", null]);
		expect(
			phases([
				{ host: host({ status: "working", queue: followUp }), last: earlier },
				{ host: host({ status: "working" }), last: PROMPT },
				{ host: host({ status: "idle" }), last: PROMPT },
			]),
		).toEqual(["seen", "seen", null]);
	});

	test("without a press, the prompt is seen while queued or while it opened the running turn", () => {
		expect([
			pressAfter(PROMPT, host({ status: "working", queue: followUp }), earlier, null)?.phase,
			pressAfter(PROMPT, host({ status: "needs-input" }), PROMPT, null)?.phase,
			pressAfter(PROMPT, host({ status: "working" }), earlier, null),
			pressAfter(PROMPT, host(), PROMPT, null),
		]).toEqual(["seen", "seen", null, null]);
	});

	test("keeps the same press while nothing changed for it, and drops a press for a prompt the session no longer offers", () => {
		const seen: Press = { phase: "seen", prompt: PROMPT };
		expect(pressAfter(PROMPT, host({ status: "working" }), steer, seen)).toBe(seen);
		expect(pressAfter(PROMPT, host(), null, pressed)).toBe(pressed);
		const other = offeredPrompt(host({ branch: onBranch({ name: "me/other" }) })) ?? "";
		expect(pressAfter(other, host({ branch: onBranch({ name: "me/other" }) }), null, pressed)).toBeNull();
	});
});
