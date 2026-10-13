import { expect, test } from "bun:test";
import { SerialLane } from "./serial-lane";

test("runs calls one at a time in arrival order, past a failure", async () => {
	const lane = new SerialLane();
	const order: string[] = [];
	const slow = lane.run(async () => {
		await Bun.sleep(5);
		order.push("slow");
	});
	const failed = lane.run(() => {
		order.push("failed");
		throw new Error("boom");
	});
	const fast = lane.run(() => order.push("fast"));
	expect(lane.busy).toBe(true);
	await slow;
	await expect(failed).rejects.toThrow("boom");
	await fast;
	expect(order).toEqual(["slow", "failed", "fast"]);
	expect(lane.busy).toBe(false);
});

test("idle settles after every call made so far, even a failed one", async () => {
	const lane = new SerialLane();
	let done = false;
	lane.run(async () => {
		await Bun.sleep(5);
		throw new Error("boom");
	}).catch(() => {});
	lane.run(() => {
		done = true;
	});
	await lane.idle();
	expect(done).toBe(true);
});
