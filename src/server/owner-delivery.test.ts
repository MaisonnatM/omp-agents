import { describe, expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { LiveSession } from "../live-session";
import type { StartResult } from "../shared/sessions";
import { type OwnerEnv, sendToOwner } from "./owner-delivery";

interface Sent {
	text: string;
	delivery: string;
}

/** A running session that records each prompt, or refuses them all like one whose omp exited. */
function session(instanceId: string, sent: Sent[], refuses = false): LiveSession {
	return fromPartial<LiveSession>({
		instanceId,
		cwd: "/work",
		prompt: async (_agent: string | null, text: string, _images: unknown, delivery: string) => {
			if (refuses) throw new Error("the session ended");
			sent.push({ text, delivery });
		},
	});
}

/** An env with `running` sessions by sessionId, whose resume runs `resume` and lists what it starts in `running`. */
function env(running: Map<string, LiveSession>, resume: (sessionId: string) => StartResult): OwnerEnv & { resumed: string[] } {
	const resumed: string[] = [];
	const byInstance = (): Map<string, LiveSession> => new Map([...running.values()].map(s => [s.instanceId, s]));
	return {
		resumed,
		live: sessionId => running.get(sessionId),
		resume: async sessionId => {
			resumed.push(sessionId);
			return resume(sessionId);
		},
		get: instanceId => byInstance().get(instanceId),
		workspaceOf: async cwd => cwd,
	};
}

const refused = (): StartResult => ({ ok: false, error: "Cannot resume: its worktree is gone" });

describe("a pull request fix sent to the session that owns the pull request", () => {
	test("a running owner, idle or mid-turn, gets it as a follow-up, which waits for a running turn rather than interrupting it", async () => {
		const sent: Sent[] = [];
		const owner = env(new Map([["s1", session("i1", sent)]]), refused);
		expect(await sendToOwner(owner, "s1", "Fix CI")).toEqual({ ok: true, instanceId: "i1", workspace: "/work", prompt: null });
		expect(sent).toEqual([{ text: "Fix CI", delivery: "followUp" }]);
		expect(owner.resumed).toEqual([]);
	});

	test("an ended owner is resumed, then gets it", async () => {
		const sent: Sent[] = [];
		const running = new Map<string, LiveSession>();
		const owner = env(running, sessionId => {
			running.set(sessionId, session("i2", sent));
			return { ok: true, instanceId: "i2", workspace: "/work", prompt: null };
		});
		expect(await sendToOwner(owner, "s2", "Address comments")).toMatchObject({ ok: true, instanceId: "i2" });
		expect(owner.resumed).toEqual(["s2"]);
		expect(sent).toEqual([{ text: "Address comments", delivery: "followUp" }]);
	});

	test("an ended owner that cannot resume, such as one whose worktree is gone, leaves it to a new session", async () => {
		const owner = env(new Map(), refused);
		expect(await sendToOwner(owner, "s3", "Fix CI")).toBeNull();
		expect(owner.resumed).toEqual(["s3"]);
	});

	test("an owner that refuses the prompt leaves it to a new session", async () => {
		const owner = env(new Map([["s4", session("i4", [], true)]]), refused);
		expect(await sendToOwner(owner, "s4", "Fix CI")).toBeNull();
	});
});
