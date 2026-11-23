import { describe, expect, test } from "bun:test";
import { join } from "node:path";

type Contract = { goal: string; constraints: string[]; files_to_change: string[]; test_first: string | null; done_when: string[]; source: string | null };
// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	contractSourceRefusal(contract: Contract, issue: string | undefined): string | undefined;
	inScope(path: string, entry: string): boolean;
	strayFiles(contract: Contract, changed: string[]): string[];
	scopeRefusal(stage: string, contract: Contract, changed: string[], base: string): string | undefined;
} = await import(join(import.meta.dir, "agent/extensions/ship.ts"));
const { contractSourceRefusal, inScope, strayFiles, scopeRefusal } = extension;

const contract = (fields: Partial<Contract> = {}): Contract => ({ goal: "Ship it", constraints: [], files_to_change: ["src/a.ts"], test_first: null, done_when: ["tests pass"], source: null, ...fields });

describe("contract source", () => {
	test("a run without an issue takes any contract", () => {
		expect(contractSourceRefusal(contract(), undefined)).toBeUndefined();
		expect(contractSourceRefusal(contract({ source: "ENG-1" }), undefined)).toBeUndefined();
	});

	test("a run with an issue takes a contract drafted from it, ignoring case and spacing", () => {
		expect(contractSourceRefusal(contract({ source: "ENG-1" }), "ENG-1")).toBeUndefined();
		expect(contractSourceRefusal(contract({ source: " eng-1 " }), "ENG-1")).toBeUndefined();
	});

	test("refuses a contract with no source or another issue's, and says how to fix", () => {
		expect(contractSourceRefusal(contract(), "ENG-1")).toBe(
			'The contract is not recorded: this run ships ENG-1, but the contract names no source. Draft its goal, files_to_change, and done_when from ENG-1\'s description and acceptance criteria, then record it again with source: "ENG-1".',
		);
		expect(contractSourceRefusal(contract({ source: "ENG-2" }), "ENG-1")).toContain("the contract names ENG-2 as its source");
	});
});

describe("contract scope", () => {
	test.each([
		["src/a.ts", "src/a.ts", true], ["src/a.ts", "./src/a.ts", true], ["src/a.ts", "src/b.ts", false],
		["src/x/a.ts", "src", true], ["src/x/a.ts", "src/", true], ["srcx/a.ts", "src", false],
		["src/a.ts", "src/*.ts", true], ["src/x/a.ts", "src/*.ts", false], ["src/x/a.ts", "src/**/*.ts", true], ["src/a.ts", "src/**/*.ts", true],
		["src/a1.ts", "src/a?.ts", true], ["srcxa.ts", "src.a.ts", false],
	])("%s is in the scope of %s: %p", (path, entry, expected) => {
		expect(inScope(path, entry)).toBe(expected);
	});

	test("lockfiles and generated files are never stray", () => {
		const changed = ["bun.lock", "web/package-lock.json", "uv.lock", "go.sum", "src/__generated__/schema.ts", "api/types.generated.ts", "src/__snapshots__/a.test.ts.snap"];
		expect(strayFiles(contract(), changed)).toEqual([]);
	});

	test("files outside files_to_change are stray unless a constraint names scope-change", () => {
		expect(strayFiles(contract({ files_to_change: ["src/**"] }), ["src/a.ts", "README.md", "web/b.ts"])).toEqual(["README.md", "web/b.ts"]);
		expect(strayFiles(contract({ constraints: ["scope-change: the fix also needs the web client"] }), ["web/b.ts"])).toEqual([]);
	});

	test("allows a branch changing only the planned files", () => {
		expect(scopeRefusal("draft_pr", contract(), ["src/a.ts", "bun.lock"], "base")).toBeUndefined();
		expect(scopeRefusal("draft_pr", contract(), [], "base")).toBeUndefined();
	});

	test("refuses draft_pr and ready_gate on a stray file, naming it and the fix", () => {
		expect(scopeRefusal("draft_pr", contract(), ["src/a.ts", "README.md", "web/b.ts"], "base")).toBe(
			"draft_pr is not recorded: the branch changes `README.md`, `web/b.ts` against base, outside the contract's files_to_change. Take them out of the branch, undoing each one's changes against base and deleting the ones it adds, then commit; or, when the change needs them, record the contract again with ship_stage({contract}), listing them or a glob that covers them in files_to_change, or adding a constraint `scope-change: <why the change grew>`. Then record draft_pr again.",
		);
		expect(scopeRefusal("ready_gate", contract(), ["web/b.ts"], "base")).toStartWith("ready_gate is not recorded: the branch changes `web/b.ts`");
	});
});
