import { describe, expect, test } from "bun:test";
import { seed } from "../../../src/shared/board";
import { BOARD_PAGE, type BoardRoute, resolveBoardView } from "./module";

const { parse, rest, query } = BOARD_PAGE.address;
const roundTrip = (route: BoardRoute) => parse(rest(route), new URLSearchParams(query(route) ?? ""));

describe("Board address", () => {
	test("each view survives its own address", () => {
		for (const route of [
			{ view: { kind: "inbox" }, thread: null },
			{ view: { kind: "inbox" }, thread: "t-1" },
			{ view: { kind: "scheduled" }, thread: null },
			{ view: { kind: "channel", id: "c-dev" }, thread: "t/a b" },
			{ view: { kind: "member", id: "session/a b" }, thread: null },
		] satisfies BoardRoute[]) {
			expect(roundTrip(route)).toEqual(route);
		}
	});

	test("an address it does not know opens the inbox", () => {
		for (const bad of ["nope", "channel", "channel/", "member", "channel/%E0%A4%A", "channel/a/b"]) {
			expect(parse(bad, new URLSearchParams())).toEqual({ view: { kind: "inbox" }, thread: null });
		}
	});
});

describe("resolveBoardView", () => {
	const state = seed(0);
	const members = new Set(["u-maxence"]);

	test("a channel or member that no longer exists opens the inbox", () => {
		expect(resolveBoardView(state, members, { kind: "channel", id: "c-gone" })).toEqual({ kind: "inbox" });
		expect(resolveBoardView(state, members, { kind: "member", id: "u-gone" })).toEqual({ kind: "inbox" });
	});

	test("a live channel or member is kept", () => {
		expect(resolveBoardView(state, members, { kind: "channel", id: "c-dev" })).toEqual({ kind: "channel", id: "c-dev" });
		expect(resolveBoardView(state, members, { kind: "member", id: "u-maxence" })).toEqual({ kind: "member", id: "u-maxence" });
	});
});
