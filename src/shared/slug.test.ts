import { expect, test } from "bun:test";
import { slug } from "./slug";

test("a slug is lower case with dashes between words, cut to its length without a trailing dash, else its fallback", () => {
	expect(slug("  Checks failed on #12! ", "event")).toBe("checks-failed-on-12");
	expect(slug("Billing v3 migration", "worker", 11)).toBe("billing-v3");
	expect(slug("¿¡!", "preset")).toBe("preset");
});
