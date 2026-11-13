import { expect, test } from "bun:test";
import { type Route, routeFromHash } from "../../routing";
import { hashForEmail } from "./thread-view";

test("the email hash opens the list, a new mail, or one account's conversation, round-trips both ids, and is not read as a layout", () => {
	const list: Route = { kind: "page", page: { kind: "email", target: null } };
	expect(hashForEmail(null)).toBe("#email");
	expect(hashForEmail("new")).toBe("#email/new");
	expect(hashForEmail({ account: "gmail-2", thread: "18f2a3c4d5e6f708" })).toBe("#email/gmail-2/18f2a3c4d5e6f708");
	expect(hashForEmail({ account: "a/b", thread: "c d" })).toBe("#email/a%2Fb/c%20d");
	expect(routeFromHash("#email")).toEqual(list);
	expect(routeFromHash("#email/")).toEqual(list);
	expect(routeFromHash("#email/new")).toEqual({ kind: "page", page: { kind: "email", target: "new" } });
	expect(routeFromHash("#email/gmail/18f2a3c4d5e6f708")).toEqual({ kind: "page", page: { kind: "email", target: { account: "gmail", thread: "18f2a3c4d5e6f708" } } });
	expect(routeFromHash(hashForEmail({ account: "a/b", thread: "c d" }))).toEqual({ kind: "page", page: { kind: "email", target: { account: "a/b", thread: "c d" } } });
	expect(routeFromHash("#email/18f2a3c4d5e6f708")).toEqual(list);
	expect(routeFromHash("#email/gmail/%E0")).toEqual(list);
	expect(routeFromHash("#emails").kind).toBe("panes");
});
