import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { clockWords, loadingToast, settleToast, toasts } from "./toaster";

afterEach(() => {
	mock.restore();
	setSystemTime();
});

test("clockWords counts minutes, then seconds in two digits, from zero", () => {
	expect([0, 999, 42_000, 65_000, 725_900, 3_600_000, -5_000].map(clockWords)).toEqual(["0:00", "0:00", "0:42", "1:05", "12:05", "60:00", "0:00"]);
});

test("settleToast adds the loading toast again under its id, as a plain toast that clears the description it had", () => {
	const now = new Date("2026-11-03T10:00:00.000Z");
	setSystemTime(now);
	const added = spyOn(toasts, "add");
	const id = loadingToast({ title: "Rebasing me/branch on main", description: "Pushing through the pre-push checks" });
	settleToast(id, { title: "Rebased me/branch on main" });
	expect(id).toStartWith("toast-");
	expect(added.mock.calls.map(([toast]) => toast)).toStrictEqual([
		{ title: "Rebasing me/branch on main", description: "Pushing through the pre-push checks", type: "loading", data: { startedAt: now.getTime() } },
		{ id, type: undefined, title: "Rebased me/branch on main", description: undefined },
	]);
});
