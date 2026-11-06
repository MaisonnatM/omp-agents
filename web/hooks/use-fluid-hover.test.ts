import { expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { itemRectsIn } from "./use-fluid-hover";

const container = fromPartial<HTMLElement>({ contains: () => true });
const row = (top: number): HTMLElement => fromPartial<HTMLElement>({ offsetParent: container, offsetTop: top, offsetLeft: 0, offsetWidth: 100, offsetHeight: 20 });
const boxless = fromPartial<HTMLElement>({ offsetParent: null, offsetTop: 0, offsetLeft: 0, offsetWidth: 0, offsetHeight: 0 });

test("a row with no layout box holds the measurement back until the last attempt, which measures the rows that have one", () => {
	const items = new Map([[0, row(0)], [1, boxless], [2, row(40)]]);
	expect(itemRectsIn(container, items, false)).toBeNull();
	const settled = itemRectsIn(container, items, true);
	expect(settled?.[0]).toEqual({ top: 0, left: 0, width: 100, height: 20 });
	expect(settled?.[1]).toBeUndefined();
	expect(settled?.[2]).toEqual({ top: 40, left: 0, width: 100, height: 20 });
});

test("a list with no row laid out stays unmeasured, so the last good rects stand while it is hidden", () => {
	expect(itemRectsIn(container, new Map([[0, boxless], [1, boxless]]), true)).toBeNull();
});
