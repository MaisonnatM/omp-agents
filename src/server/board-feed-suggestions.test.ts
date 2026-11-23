import { expect, test } from "bun:test";
import type { RosterHost } from "../shared/sessions";
import { splitSuggestions } from "../shared/transcript";
import { feedText } from "./board-feed";

const finished = (unread: RosterHost["unread"]): RosterHost => ({ sessionId: "s1", sessionName: "fix login", requests: [], status: "idle", unread }) as unknown as RosterHost;

test("a finished turn's post ends on the prompts its reply suggests, which the thread reads back as replies", () => {
	const text = feedText(finished({ at: 4, reply: "Fixed it.", suggestions: ["Merge on main", "Add a test"] }), "working", "Maxence");
	expect(splitSuggestions(text!)).toEqual({ body: "@Maxence finished: Fixed it.", suggestions: ["Merge on main", "Add a test"] });
	expect(feedText(finished({ at: 4, reply: "Fixed it." }), "working", "Maxence")).toBe("@Maxence finished: Fixed it.");
});
