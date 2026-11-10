import { expect, test } from "bun:test";
import { typedPeople } from "./mail-editor";

test("a typed list names each person, with or without a display name", () => {
	expect(typedPeople('ana@x.com; "Ben Roy" <ben@y.com>, Cy <cy@z.org>')).toEqual([
		{ name: "", address: "ana@x.com" },
		{ name: "Ben Roy", address: "ben@y.com" },
		{ name: "Cy", address: "cy@z.org" },
	]);
});

test("a pasted list that ends with a comma or a semicolon adds the people before it", () => {
	const both = [
		{ name: "", address: "a@x.com" },
		{ name: "", address: "b@y.com" },
	];
	expect(typedPeople("a@x.com, b@y.com,")).toEqual(both);
	expect(typedPeople("a@x.com; b@y.com; ")).toEqual(both);
});

test("a part that is not an address refuses the whole list", () => {
	expect(typedPeople("a@x.com, ben")).toBeNull();
});
