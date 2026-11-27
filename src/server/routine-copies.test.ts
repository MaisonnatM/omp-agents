import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { flushJsonFiles } from "../fs";
import { applyRoutine, type Routine, type RoutineSpec } from "../routines";
import { inTempDir } from "../shared/workspaces";
import { copiesFor, RoutineCopies, takesCopies } from "./routine-copies";

const APP = "/repos/app";
const WEB = "/repos/web";
const API = "/repos/api";

const template: RoutineSpec = {
	id: "t1",
	workspace: APP,
	name: "Shepherd pull requests",
	schedules: [],
	triggers: [{ kind: "pull-request" }],
	task: { kind: "prompt", prompt: "Get my pull requests merged." },
	enabled: true,
	launch: { model: null, thinking: "high", skill: null },
	everyWorkspace: true,
};

const { everyWorkspace: _, ...plain } = template;

const saved = (...specs: RoutineSpec[]): Routine[] => specs.reduce<Routine[]>((routines, routine) => applyRoutine(routines, { op: "save", routine }, 1), []);

const ids = (): (() => string) => {
	let next = 0;
	return () => `copy-${++next}`;
};

describe("copiesFor", () => {
	test("a template turned on goes to every eligible Workspace that has it neither as its own nor as a copy", () => {
		const copied = { ...plain, id: "c0", workspace: WEB, copyOf: "t1" };
		const routines = saved(template, copied);
		const { copies, seen } = copiesFor(routines, [APP, WEB, API], { workspaces: [APP, WEB, API], templates: [], linked: true }, ids());
		expect(copies).toEqual([
			{ id: "copy-1", workspace: API, name: template.name, schedules: [], triggers: template.triggers, task: template.task, enabled: true, launch: template.launch, copyOf: "t1", linked: true },
		]);
		expect(seen).toEqual({ workspaces: [APP, WEB, API], templates: ["t1"], linked: true });
	});

	test("a copy starts disabled when its template is", () => {
		const { copies } = copiesFor(saved({ ...template, enabled: false }), [WEB], { workspaces: [], templates: [] }, ids());
		expect(copies.map(copy => [copy.workspace, copy.enabled, copy.everyWorkspace])).toEqual([[WEB, false, undefined]]);
	});

	test("a Workspace not seen before gets every template it lacks, and a seen one gets none of the seen templates", () => {
		const other = { ...template, id: "t2", workspace: WEB, name: "Weekly cleanup" };
		const { copies } = copiesFor(saved(template, other), [APP, WEB, API], { workspaces: [APP, WEB], templates: ["t1", "t2"] }, ids());
		expect(copies.map(copy => [copy.workspace, copy.copyOf])).toEqual([
			[API, "t1"],
			[API, "t2"],
		]);
	});

	test("the first run, with nothing seen, copies nothing and sees what is there", () => {
		expect(copiesFor(saved(template), [APP, WEB], null, ids())).toEqual({ copies: [], links: [], seen: { workspaces: [APP, WEB], templates: ["t1"], linked: true } });
	});

	test("a deleted copy is not copied again, and repeating copies nothing", () => {
		const first = copiesFor(saved(template), [APP, WEB], { workspaces: [APP], templates: ["t1"], linked: true }, ids());
		expect(first.copies.map(copy => copy.workspace)).toEqual([WEB]);
		// The copy in WEB was deleted: WEB and the template are both seen, so it stays deleted.
		expect(copiesFor(saved(template), [APP, WEB], first.seen, ids())).toEqual({ copies: [], links: [], seen: first.seen });
	});

	test("a Workspace left out of the eligible ones gets nothing, and still counts as new once it is eligible", () => {
		const hidden = copiesFor(saved(template), [APP], { workspaces: [APP], templates: [], linked: true }, ids());
		expect(hidden).toEqual({ copies: [], links: [], seen: { workspaces: [APP], templates: ["t1"], linked: true } });
		expect(copiesFor(saved(template), [APP, WEB], hidden.seen, ids()).copies.map(copy => copy.workspace)).toEqual([WEB]);
	});

	test("a template turned off and on again copies again where it is missing; a turned-off one copies nowhere", () => {
		const seen = { workspaces: [APP, WEB], templates: ["t1"], linked: true as const };
		const off = copiesFor(saved(plain), [APP, WEB, API], seen, ids());
		expect(off).toEqual({ copies: [], links: [], seen: { workspaces: [APP, WEB, API], templates: [], linked: true } });
		expect(copiesFor(saved(template), [APP, WEB, API], off.seen, ids()).copies.map(copy => copy.workspace)).toEqual([WEB, API]);
	});
});

describe("RoutineCopies", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function setUp(eligible: string[]) {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-copies-"));
		dirs.push(dir);
		let routines = saved(plain);
		const copies = new RoutineCopies({
			path: join(dir, "routine-copies.json"),
			routines: () => routines,
			eligible: () => eligible,
			save: routine => {
				routines = applyRoutine(routines, { op: "save", routine }, 2);
			},
			newId: ids(),
		});
		const edit = (next: (routines: Routine[]) => Routine[]): void => {
			routines = next(routines);
		};
		return { copies, routines: () => routines, edit };
	}

	test("sees on its first check, copies a template turned on after, and keeps a deleted copy deleted across checks", () => {
		const eligible = [APP, WEB];
		const { copies, routines, edit } = setUp(eligible);
		copies.check();
		flushJsonFiles();
		expect(routines()).toHaveLength(1);

		edit(list => applyRoutine(list, { op: "save", routine: template }, 3));
		copies.check();
		copies.check();
		flushJsonFiles();
		expect(routines().map(routine => [routine.workspace, routine.copyOf ?? null, routine.createdAt])).toEqual([
			[APP, null, 1],
			[WEB, "t1", 2],
		]);

		edit(list => applyRoutine(list, { op: "remove", id: "copy-1" }, 4));
		copies.check();
		flushJsonFiles();
		expect(routines().map(routine => routine.id)).toEqual(["t1"]);

		eligible.push(API);
		copies.check();
		flushJsonFiles();
		expect(routines().map(routine => [routine.workspace, routine.copyOf ?? null])).toEqual([
			[APP, null],
			[API, "t1"],
		]);
	});

	test("links, once, the copies made before copies followed their template that still match it, and only those follow its edits", () => {
		const { copies, routines, edit } = setUp([APP, WEB, API]);
		writeFileSync(join(dirs[0]!, "routine-copies.json"), JSON.stringify({ workspaces: [APP, WEB, API], templates: ["t1"] }));
		const { everyWorkspace: _every, ...copied } = template;
		edit(() => saved(template, { ...copied, id: "same", workspace: WEB, copyOf: "t1" }, { ...copied, id: "own", workspace: API, copyOf: "t1", task: { kind: "prompt", prompt: "Mine." } }));
		copies.check();
		flushJsonFiles();
		expect(routines().map(routine => [routine.id, routine.linked ?? false])).toEqual([
			["t1", false],
			["same", true],
			["own", false],
		]);

		edit(list => applyRoutine(list, { op: "save", routine: { ...template, task: { kind: "prompt", prompt: "Updated." } } }, 3));
		expect(routines().map(routine => routine.task)).toEqual([{ kind: "prompt", prompt: "Updated." }, { kind: "prompt", prompt: "Updated." }, { kind: "prompt", prompt: "Mine." }]);

		edit(list => applyRoutine(list, { op: "save", routine: { ...copied, id: "own", workspace: API, copyOf: "t1", task: { kind: "prompt", prompt: "Updated." } } }, 4));
		copies.check();
		expect(routines().find(routine => routine.id === "own")?.linked).toBeUndefined();
	});
});

describe("takesCopies", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	test("takes a repository's main checkout, and no directory under a temp root, gone, or outside git", () => {
		const repo = dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim());
		expect(takesCopies(repo)).toBe(!inTempDir(repo));
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-copies-"));
		dirs.push(dir);
		const main = join(dir, "main");
		mkdirSync(join(main, ".git"), { recursive: true });
		const linked = join(dir, "linked");
		mkdirSync(linked);
		writeFileSync(join(linked, ".git"), "gitdir: elsewhere\n");
		expect([main, linked, join(dir, "gone"), dir, "/repos/missing"].map(takesCopies)).toEqual([false, false, false, false, false]);
	});
});
