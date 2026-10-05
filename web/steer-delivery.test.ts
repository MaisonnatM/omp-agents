import { expect, test } from "bun:test";
import { type SteerDelivery, type SteerDeliveryEvent, steerDelivery } from "./steer-delivery";

const fold = (events: SteerDeliveryEvent[], phase: SteerDelivery = "idle"): SteerDelivery => events.reduce(steerDelivery, phase);

test("a steer arms the next empty Enter, and the queue taking that steer disarms it", () => {
	expect(fold([{ t: "working", working: true }, { t: "steer" }])).toBe("armed");
	expect(fold([{ t: "flush" }, { t: "interrupt" }])).toBe("idle");
	expect(fold([{ t: "steer" }, { t: "queue", steering: 1 }, { t: "queue", steering: 0 }])).toBe("idle");
});

test("a steering queue that is already showing arms Enter before this composer sends anything", () => {
	expect(fold([{ t: "working", working: true }, { t: "queue", steering: 2 }])).toBe("armed");
	expect(fold([{ t: "working", working: true }, { t: "queue", steering: 0 }])).toBe("idle");
});

test("flushing keeps the queue from arming Enter again until that steer leaves", () => {
	const flushed = fold([{ t: "steer" }, { t: "flush" }, { t: "queue", steering: 1 }]);
	expect(flushed).toBe("settling");
	expect(fold([{ t: "working", working: false }, { t: "working", working: true }, { t: "queue", steering: 1 }], flushed)).toBe("settling");
	expect(fold([{ t: "queue", steering: 0 }], flushed)).toBe("idle");
});

test("the turn ending drops an armed steer that never reached the queue, and Esc holds the queue back", () => {
	expect(fold([{ t: "steer" }, { t: "working", working: false }])).toBe("idle");
	expect(fold([{ t: "queue", steering: 1 }, { t: "interrupt" }, { t: "queue", steering: 1 }])).toBe("settling");
	expect(fold([{ t: "interrupt" }, { t: "queue", steering: 0 }])).toBe("idle");
});

test("a steer sent while a flush is settling becomes the next one Enter can deliver", () => {
	expect(fold([{ t: "steer" }, { t: "flush" }, { t: "steer" }])).toBe("armed");
	expect(fold([{ t: "flush" }])).toBe("idle");
});
