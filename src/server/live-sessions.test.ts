import { describe, expect, test } from "bun:test";
import type { SessionFacts } from "../live-session";
import { withSubject } from "./live-sessions";

const facts: SessionFacts = { pullRequests: [{ owner: "acme", repo: "webapp", number: 7, link: "submitted" }], tickets: ["ENG-1"], ship: null };

describe("withSubject", () => {
	test("puts a quick action's pull request or issue first among the session's links", () => {
		expect(withSubject(facts, { kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 12 } }).pullRequests).toEqual([
			{ owner: "acme", repo: "webapp", number: 12, link: "worked" },
			{ owner: "acme", repo: "webapp", number: 7, link: "submitted" },
		]);
		expect(withSubject(facts, { kind: "ticket", id: "ENG-2" }).tickets).toEqual(["ENG-2", "ENG-1"]);
	});

	test("keeps the links as the tool calls found them once they name the subject", () => {
		expect(withSubject(facts, { kind: "pull-request", pr: { owner: "ACME", repo: "webapp", number: 7 } })).toEqual(facts);
		expect(withSubject(facts, { kind: "ticket", id: "ENG-1" })).toEqual(facts);
		expect(withSubject(facts, undefined)).toEqual(facts);
	});
});
