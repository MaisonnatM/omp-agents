import { describe, expect, test } from "bun:test";
import { dataOf, mutationOf } from "./github";

describe("mutationOf", () => {
	const refused = {
		data: { resolveReviewThread: null },
		errors: [{ type: "NOT_FOUND", path: ["resolveReviewThread"], message: "Could not resolve to a node with the global id of 'PRRT_x'" }],
	};

	test("throws GitHub's errors beside a refused mutation's null field, which dataOf takes as data", () => {
		expect(dataOf(refused)).toEqual({ resolveReviewThread: null });
		expect(() => mutationOf(refused)).toThrow("Could not resolve to a node with the global id of 'PRRT_x'");
	});

	test("answers the data of a mutation GitHub took", () => {
		expect(mutationOf({ data: { addComment: { clientMutationId: null } } })).toEqual({ addComment: { clientMutationId: null } });
	});
});
