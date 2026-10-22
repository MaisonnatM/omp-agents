import { describe, expect, test } from "bun:test";
import { orderByImports, orderPullRequestFiles } from "./pull-request-order";

describe("orderByImports", () => {
	test("takes the alphabetically first ready path, even one an earlier step released", () => {
		expect(orderByImports(["d.ts", "a.ts", "b.ts"], new Map([["a.ts", new Set(["b.ts"])]]))).toEqual(["b.ts", "a.ts", "d.ts"]);
	});

	test("breaks a cycle at its alphabetically first path", () => {
		expect(orderByImports(["c.ts", "b.ts", "a.ts"], new Map([["a.ts", new Set(["c.ts"])], ["b.ts", new Set(["a.ts"])], ["c.ts", new Set(["b.ts"])]]))).toEqual(["a.ts", "b.ts", "c.ts"]);
	});
});

describe("orderPullRequestFiles", () => {
	test("orders source dependencies before dependents, then matching tests, then generated files", () => {
		const files = [
			{ path: "src/a.ts", patch: "@@ -1 +1 @@\n-import { z } from './z.js';\n+import { z } from './z.js';" },
			{ path: "src/a.test.ts", patch: null },
			{ path: "bun.lock", patch: null },
			{ path: "src/z.ts", patch: null },
			{ path: "tests/z.spec.ts", patch: null },
			{ path: "src/a.generated.ts", patch: null },
			{ path: "tests/unmatched.test.ts", patch: null },
			{ path: "dist/app.js", patch: null },
		];
		expect(orderPullRequestFiles(files).map(file => file.path)).toEqual(["src/z.ts", "src/a.ts", "tests/z.spec.ts", "src/a.test.ts", "tests/unmatched.test.ts", "bun.lock", "dist/app.js", "src/a.generated.ts"]);
		expect(files[0]?.path).toBe("src/a.ts");
	});

	test("resolves relative indexes, side effects, require, dynamic import and unique aliased basenames", () => {
		const paths = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/folder/index.ts", "src/z.ts"];
		const patches: Record<string, string> = {
			"src/a.ts": "+import './folder';",
			"src/folder/index.ts": "+const value = require('../b');",
			"src/b.ts": "+const value = import('./c');",
			"src/c.ts": "+export { value } from './d';",
			"src/d.ts": "+import { value } from '~/shared/z';",
		};
		expect(orderPullRequestFiles(paths.map(path => ({ path, patch: patches[path] ?? null }))).map(file => file.path)).toEqual(["src/z.ts", "src/d.ts", "src/c.ts", "src/b.ts", "src/folder/index.ts", "src/a.ts"]);
	});

	test("breaks cycles alphabetically and does not guess ambiguous module basenames", () => {
		const files = [
			{ path: "src/b.ts", patch: "+import './a';" },
			{ path: "src/a.ts", patch: "+import './b';" },
			{ path: "a.ts", patch: "+import 'elsewhere/name';" },
			{ path: "one/name.ts", patch: null },
			{ path: "two/name.ts", patch: null },
		];
		expect(orderPullRequestFiles(files).map(file => file.path)).toEqual(["a.ts", "one/name.ts", "two/name.ts", "src/a.ts", "src/b.ts"]);
	});
});
