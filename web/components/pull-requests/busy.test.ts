import { expect, test } from "bun:test";
import { busyWords } from "./busy";

test("busyWords words a rebase by where it stands in the queue, and a starting session by its quick action", () => {
	expect([busyWords({ kind: "rebase", state: "queued" }), busyWords({ kind: "rebase", state: "running" }), busyWords({ kind: "start", action: "work" })]).toEqual([
		{ label: "Queued to rebase", short: "Queued" },
		{ label: "Rebasing", short: "Rebasing" },
		{ label: "Starting Work on it", short: "Starting" },
	]);
});
