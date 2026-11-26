import { lineAt, type Rule } from "../rule";

const OMP_PACKAGE = /@oh-my-pi\/|pi-coding-agent/;
const IMPORT = /\bimport\s*\(\s*([^)]*?)\s*[,)]|\b(?:from|import)\s+(["'`])([^"'`]+)\2|\brequire\s*\(\s*(["'`])([^"'`]+)\4/g;

/** `src/keeper.ts` outlives the server and so cannot load `src/omp/modules.ts`; it imports omp's frame decoder by a path the server hands it. */
const EXEMPT = new Set(["src/keeper.ts"]);

export const ompSeam: Rule = {
	id: "omp-seam",
	why: "Load omp's code only in src/omp/, through src/omp/modules.ts, so an omp update breaks one place; see CODING_STANDARDS.md#omp-imports.",
	appliesTo: path => /^(src|web|desktop)\/.*\.tsx?$/.test(path) && !path.startsWith("src/omp/") && !/\.test\.tsx?$/.test(path) && !EXEMPT.has(path),
	check(source) {
		const found = [];
		for (const match of source.matchAll(IMPORT)) {
			const dynamic = match[1];
			const specifier = match[3] ?? match[5];
			if (dynamic !== undefined && !/^(["'`])[^"'`$]*\1$/.test(dynamic))
				found.push({ line: lineAt(source, match.index), message: `import(${dynamic}) loads a module by computed path; load omp's modules in src/omp/modules.ts` });
			else if (OMP_PACKAGE.test(specifier ?? dynamic ?? ""))
				found.push({ line: lineAt(source, match.index), message: `${match[0]} imports omp's package outside src/omp/` });
		}
		return found;
	},
};
