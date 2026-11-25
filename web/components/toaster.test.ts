import { afterEach, expect, setSystemTime, test } from "bun:test";
import { clockWords, loadingToast, settleToast, toasts } from "./toaster";

afterEach(() => {
	toasts.dismiss();
	setSystemTime();
});

test("clockWords counts minutes, then seconds in two digits, from zero", () => {
	expect([0, 999, 42_000, 65_000, 725_900, 3_600_000, -5_000].map(clockWords)).toEqual(["0:00", "0:00", "0:42", "1:05", "12:05", "60:00", "0:00"]);
});

test("settleToast turns the loading toast into a plain toast under its id that clears the description it had, and adds it again once swiped away", () => {
	const now = new Date("2026-11-03T10:00:00.000Z");
	setSystemTime(now);
	const shown = () => toasts.toasts().map(({ id, type, title, description, duration, data }) => ({ id, type, title, description, duration, data }));
	const id = loadingToast({ title: "Rebasing me/branch on main", description: "Pushing through the pre-push checks" });
	expect(id).toStartWith("toast-");
	expect(shown()).toStrictEqual([
		{ id, type: "loading", title: "Rebasing me/branch on main", description: "Pushing through the pre-push checks", duration: Infinity, data: { startedAt: now.getTime() } },
	]);
	settleToast(id, { title: "Rebased me/branch on main" });
	expect(shown()).toStrictEqual([{ id, type: "default", title: "Rebased me/branch on main", description: undefined, duration: 5000, data: { startedAt: now.getTime() } }]);
	toasts.dismiss(id);
	settleToast(id, { title: "Rebased me/branch on main" });
	expect(shown()).toStrictEqual([{ id, type: "default", title: "Rebased me/branch on main", description: undefined, duration: 5000, data: undefined }]);
});
