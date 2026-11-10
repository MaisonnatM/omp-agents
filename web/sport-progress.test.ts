import { describe, expect, test } from "bun:test";
import { log, measurement, STATE, withLogs, withMeasurements } from "../src/sport-fixtures";
import { chartOf, figureId, planStart, progressCards, RANGES, rangeStart, targetOf } from "./sport-progress";

const max = STATE.metrics[0]!;
const tested = withMeasurements(STATE, measurement("m3", "max", 117, "2026-11-24"));

describe("progress", () => {
	test("the cards read each metric, the best grades over 8 weeks with their targets, the bodyweight last, then the plan followed", () => {
		expect(progressCards(tested, "2026-11-25").map(({ figure, value, detail }) => [figureId(figure), value, detail])).toEqual([
			["metric-max", "117 kg", "+5 kg depuis 26 août"],
			["boulder", "—", "objectif 8a"],
			["route", "—", "aucun objectif"],
			["metric-bodyweight", "82 kg", "le 26 août"],
			["plan", "0 %", "0 séances sur 11"],
		]);
	});

	test("before the plan starts, the plan card and chart say so", () => {
		expect(progressCards(STATE, "2026-11-10").at(-1)).toMatchObject({ value: "—", detail: "le plan n'a pas commencé" });
		expect(chartOf(STATE, { kind: "plan" }, null, "2026-11-10")).toMatchObject({ spec: { data: [] }, empty: "Le plan n'a pas encore commencé." });
	});

	test("with no plan, the plan chart says the plan has not started instead of drawing an empty week", () => {
		expect(chartOf({ ...STATE, plan: null }, { kind: "plan" }, null, "2026-11-25")).toMatchObject({ spec: { data: [] }, empty: "Le plan n'a pas encore commencé." });
	});

	test("a metric's chart says how far it moved, what is left to its target, and the next test, with the target as its line", () => {
		const chart = chartOf(tested, { kind: "metric", metric: max }, null, "2026-11-25");
		expect(chart.sentence).toBe("+5 kg depuis le 26 août. Il te reste 2 kg pour atteindre 119 kg d'ici le 7 févr. Prochain test le 29 déc.");
		expect(chart.reference).toEqual({ value: 119, label: "Objectif 119 kg" });
		expect(chart.spec.data).toEqual([{ day: "26 août", value: 112 }, { day: "24 nov.", value: 117 }]);
	});

	test("a range reaches back whole weeks from this Monday, and « Tout » reaches everything", () => {
		expect(RANGES.map(range => rangeStart(range, "2026-11-25"))).toEqual(["2026-10-05", "2026-09-07", null]);
	});

	test("the plan starts with its first phase, and each figure finds its own target", () => {
		expect(planStart(STATE.plan)).toBe("2026-11-16");
		expect(planStart(null)).toBeNull();
		expect(targetOf(STATE, { kind: "grade", climb: "boulder" })?.id).toBe("t2");
		expect(targetOf(STATE, { kind: "grade", climb: "route" })).toBeNull();
		expect(targetOf(STATE, { kind: "plan" })).toBeNull();
	});

	test("a grade chart draws each week's best send against its target", () => {
		const state = withLogs(STATE, log("l1", "2026-11-17", { climbs: [{ kind: "boulder", grade: "7a", color: null, kilter: false, attempts: null }] }));
		const chart = chartOf(state, { kind: "grade", climb: "boulder" }, null, "2026-11-25");
		expect(chart.sentence).toEndWith(": 7a, objectif 8a.");
		expect(chart.format(chart.reference!.value)).toBe("8a");
	});
});
