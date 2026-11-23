import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHORTCUTS } from "./shortcuts";

/**
 * A Base UI dialog's popup stops the arrows, Home, and End from bubbling, so a `useShortcuts` binding on one of them
 * never fires while the dialog has focus; such a binding goes through `usePopupShortcuts` on the popup instead.
 */
const root = join(import.meta.dir, "..");
const STOPPED_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
const STOPPED_IDS = SHORTCUTS.filter(({ keys }) => keys.some(binding => "chord" in binding && STOPPED_KEYS.has(binding.chord.key))).map(({ id }) => id);

/** The text between the parentheses that open at `open`, the index just past `(`. */
function argumentsAt(source: string, open: number): string {
	let depth = 1;
	let end = open;
	while (end < source.length && depth > 0) {
		if (source[end] === "(") depth++;
		else if (source[end] === ")") depth--;
		end++;
	}
	return source.slice(open, end);
}

/**
 * Each `useShortcuts` call, in a file that renders a Base UI dialog, that binds a key the popup stops.
 * A dialog shell is a file that imports Base UI's dialog, or one that renders a shell and forwards `children` and
 * `onKeyDown` into it, such as the Sport page's `SportDialog`; a file renders a dialog when it renders a shell's export.
 */
function unreachableBindings(files: Record<string, string>): string[] {
	const shellFiles = new Set(Object.keys(files).filter(file => files[file].includes('"@base-ui/react/dialog"')));
	const shells = new Set<string>();
	const rendersShell = (source: string) => [...shells].some(name => new RegExp(`<${name}[\\s/>]`).test(source));
	for (let grew = true; grew; ) {
		grew = false;
		for (const file of shellFiles) {
			for (const [, name] of files[file].matchAll(/export (?:function|const) ([A-Z][a-z]\w*)/g)) {
				if (shells.has(name)) continue;
				shells.add(name);
				grew = true;
			}
		}
		for (const [file, source] of Object.entries(files)) {
			if (shellFiles.has(file) || !/\bchildren\??:\s*ReactNode/.test(source) || !/\bonKeyDown\??:/.test(source) || !rendersShell(source)) continue;
			shellFiles.add(file);
			grew = true;
		}
	}
	return Object.entries(files).flatMap(([file, source]) => {
		if (!shellFiles.has(file) && !rendersShell(source)) return [];
		return [...source.matchAll(/\buseShortcuts\(/g)].flatMap(match => {
			const args = argumentsAt(source, match.index + match[0].length);
			const stopped = STOPPED_IDS.filter(id => new RegExp(`\\b${id}\\b`).test(args));
			const line = source.slice(0, match.index).split("\n").length;
			return stopped.length ? [`${file}:${line} binds ${stopped.join(", ")} with useShortcuts inside a Base UI dialog; use usePopupShortcuts on the popup`] : [];
		});
	});
}

test("an arrow binding through useShortcuts inside a Base UI dialog is caught", () => {
	const files = {
		"web/components/form-dialog.tsx": `import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";\nexport function FormDialog() {}\nexport function FormDialogHeader() {}\n`,
		"web/components/sport/sport-dialog.tsx": `interface Props { children: ReactNode; onKeyDown?: (event: KeyboardEvent) => void }\nexport function SportDialog({ children }: Props) {\n\treturn <FormDialog>{children}</FormDialog>;\n}\n`,
		"web/components/bad.tsx": `export function Bad() {\n\tuseShortcuts({ sportTimerNext: next, sportTimerPause: toggle });\n\treturn <SportDialog title="x" />;\n}\n`,
		"web/components/good.tsx": `export function Good() {\n\tconst keys = usePopupShortcuts({ sportTimerNext: next });\n\tuseShortcuts({ sportTimerPause: toggle });\n\treturn <SportDialog onKeyDown={keys} />;\n}\n`,
		"web/components/page.tsx": `export function Page() {\n\tuseShortcuts({ sportTimerNext: next });\n\treturn <Good />;\n}\n`,
	};
	expect(STOPPED_IDS).toContain("sportTimerNext");
	expect(STOPPED_IDS).not.toContain("sportTimerPause");
	expect(unreachableBindings(files)).toEqual(["web/components/bad.tsx:2 binds sportTimerNext with useShortcuts inside a Base UI dialog; use usePopupShortcuts on the popup"]);
});

test("no Base UI dialog binds an arrow, Home, or End through useShortcuts", () => {
	const paths = [...new Bun.Glob("web/**/*.{ts,tsx}").scanSync({ cwd: root })].filter(file => !/\.test\.tsx?$/.test(file)).sort();
	const files = Object.fromEntries(paths.map(file => [file, readFileSync(join(root, file), "utf8")]));
	expect(files["web/components/form-dialog.tsx"]).toContain('"@base-ui/react/dialog"');
	expect(unreachableBindings(files)).toEqual([]);
});
