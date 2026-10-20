import { describe, expect, test } from "bun:test";
import type { SessionBranch } from "../src/shared/sessions";
import { type Flight, offeredPrompt, type OpenPullRequestHost, phaseOf } from "./open-pull-request";

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
const pressed: Flight = { prompt: PROMPT, answered: false };
const answered: Flight = { prompt: PROMPT, answered: true };
const earlier = "an earlier prompt";

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

describe("phaseOf", () => {
	test("keeps a press in flight until the session shows it took the prompt, or the server answered and no turn runs", () => {
		expect([
			phaseOf(PROMPT, host(), null, pressed),
			phaseOf(PROMPT, host({ status: "working" }), earlier, answered),
			phaseOf(PROMPT, host(), earlier, answered),
		]).toEqual(["flight", "flight", null]);
	});

	test("an idle click that lands releases once the turn it opened ends, though no queue ever held the prompt", () => {
		expect([
			phaseOf(PROMPT, host(), PROMPT, pressed),
			phaseOf(PROMPT, host({ status: "working" }), PROMPT, answered),
			phaseOf(PROMPT, host({ status: "idle" }), PROMPT, answered),
		]).toEqual([null, "seen", null]);
	});

	test("a follow-up is seen while queued and while its turn runs, and released once that turn ends or another runs", () => {
		const queued = { steering: [], followUp: [PROMPT] };
		expect([
			phaseOf(PROMPT, host({ status: "working", queue: queued }), earlier, pressed),
			phaseOf(PROMPT, host({ status: "working", queue: queued }), earlier, null),
			phaseOf(PROMPT, host({ status: "working" }), PROMPT, null),
			phaseOf(PROMPT, host({ status: "idle" }), PROMPT, null),
			phaseOf(PROMPT, host({ status: "working" }), "a later prompt", null),
		]).toEqual(["seen", "seen", "seen", null, null]);
	});

	test("a session that waits on a question or reports no status yet has not ended the turn: an answered press stays in flight and the turn it opened stays seen", () => {
		expect([
			phaseOf(PROMPT, host({ status: "needs-input" }), earlier, answered),
			phaseOf(PROMPT, host({ status: "unknown" }), earlier, answered),
			phaseOf(PROMPT, host({ status: "needs-input" }), PROMPT, null),
			phaseOf(PROMPT, host({ status: "unknown" }), PROMPT, null),
			phaseOf(PROMPT, host({ status: "needs-input" }), "a later prompt", null),
		]).toEqual(["flight", "flight", "seen", "seen", null]);
	});

	test("a press for a prompt the session no longer offers is not in flight", () => {
		const other = offeredPrompt(host({ branch: onBranch({ name: "me/other" }) })) ?? "";
		expect(phaseOf(other, host({ branch: onBranch({ name: "me/other" }) }), null, pressed)).toBeNull();
	});
});
