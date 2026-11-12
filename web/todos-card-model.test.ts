import { describe, expect, test } from "bun:test";
import { countLabel } from "./todos-card-model";

describe("countLabel", () => {
	test("names one in the singular and any other count in the plural", () => {
		expect(countLabel(1, "File", "Files")).toBe("1 File");
		expect(countLabel(7, "File", "Files")).toBe("7 Files");
		expect(countLabel(0, "File", "Files")).toBe("0 Files");
	});
});
