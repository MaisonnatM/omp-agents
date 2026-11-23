import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureDetail, formatReport, parseJunit } from "./agent-test";

const SCRIPT = join(import.meta.dir, "agent-test.ts");
const dirs: string[] = [];

function project(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "agent-test-test-"));
	dirs.push(dir);
	for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
	return dir;
}

function run(dir: string, ...args: string[]): { lines: string[]; exitCode: number } {
	const done = Bun.spawnSync([process.execPath, SCRIPT, ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
	return { lines: done.stdout.toString().trimEnd().split("\n"), exitCode: done.exitCode };
}

const PASSING = `import { expect, test } from "bun:test";
test("adds", () => { expect(1 + 1).toBe(2); });
test.skip("later", () => {});
`;

const FAILING = `import { describe, expect, test } from "bun:test";
describe("math", () => { test("multiplies", () => { expect(2 * 2).toBe(5); }); });
test("throws", () => { throw new Error("boom"); });
`;

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bun run test:agent", () => {
	test("prints counts and one line per failure, and exits as bun test does", () => {
		const { lines, exitCode } = run(project({ "pass.test.ts": PASSING, "fail.test.ts": FAILING }));
		expect(exitCode).toBe(1);
		expect(lines[0]).toMatch(/^PASS 1 FAIL 2 SKIP 1 \(\d+\.\ds\)$/);
		expect(lines.slice(1).sort()).toEqual([
			"ERROR fail.test.ts > math > multiplies > expect(received).toBe(expected): expected 5, received 4",
			"ERROR fail.test.ts > throws > Error: boom",
		]);
	});

	test("passes its arguments to bun test and exits 0 when every test passes", () => {
		const { lines, exitCode } = run(project({ "pass.test.ts": PASSING, "fail.test.ts": FAILING }), "pass.test.ts");
		expect(exitCode).toBe(0);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/^PASS 1 FAIL 0 SKIP 1 \(\d+\.\ds\)$/);
	});

	test("reports a test file that throws while loading", () => {
		const { lines, exitCode } = run(project({ "load.test.ts": 'throw new Error("load boom");\n' }));
		expect(exitCode).toBe(1);
		expect(lines.slice(1)).toEqual(["ERROR load.test.ts > (unhandled error between tests) > load boom"]);
	});
});

describe("failureDetail", () => {
	test("takes expected and received from a diff", () => {
		const message = 'expect(received).toEqual(expected)\n\n  {\n-   "a": 2,\n+   "a": 1,\n  }\n\n- Expected  - 1\n+ Received  + 1\n';
		expect(failureDetail("AssertionError", message)).toBe('expect(received).toEqual(expected): expected "a": 2, received "a": 1');
	});
});

describe("formatReport", () => {
	test("caps the failure lines", () => {
		const cases = Array.from(
			{ length: 32 },
			(_, index) => `<testcase name="t${index}" file="a.test.ts"><failure type="Error" message="no ${index}" /></testcase>`,
		).join("");
		const xml = `<testsuites tests="32" failures="32" skipped="0"><testsuite name="a.test.ts">${cases}</testsuite></testsuites>`;
		const lines = formatReport(parseJunit(xml), 1, 1, "");
		expect(lines).toHaveLength(32);
		expect(lines[0]).toBe("PASS 0 FAIL 32 SKIP 0 (1.0s)");
		expect(lines[30]).toBe("ERROR a.test.ts > t29 > Error: no 29");
		expect(lines[31]).toBe("… and 2 more");
	});
});
