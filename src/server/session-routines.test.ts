import { describe, expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { applyRoutine, type Routine, type RoutineChange, type RoutineSpec } from "../routines";
import type { RosterHost } from "../shared/sessions";
import { SessionRoutines } from "./session-routines";

const OURS = "/repos/app";
const THEIRS = "/repos/other";

function setup(own: RoutineSpec[] = []) {
	const hosts = [fromPartial<RosterHost>({ instanceId: "i1", sessionId: "s-i1", cwd: `${OURS}-wt/feature` })];
	const theirs: RoutineSpec = { id: "theirs", workspace: THEIRS, name: "Theirs", schedules: [{ kind: "every", minutes: 60 }], triggers: [], task: { kind: "prompt", prompt: "Look." }, enabled: true };
	let routines: Routine[] = [theirs, ...own].reduce<Routine[]>((list, routine) => applyRoutine(list, { op: "save", routine }, 1), []);
	const changes: RoutineChange[] = [];
	const tools = new SessionRoutines({
		hosts: () => hosts,
		workspaceOf: async cwd => (cwd.startsWith(OURS) ? OURS : cwd),
		routines: () => routines,
		apply: change => {
			changes.push(change);
			routines = applyRoutine(routines, change, 2);
		},
	});
	const call = (name: string, args: Record<string, unknown>, caller = "i1") =>
		tools
			.join(caller)
			.rpc.tools.find(tool => tool.name === name)!
			.execute(args, { toolCallId: "c1", signal: new AbortController().signal });
	const fields = { name: "Nightly triage", enabled: false, schedules: [{ kind: "every", minutes: 1440 }], triggers: [], task: { kind: "prompt", prompt: "Triage the issues." }, launch: null };
	return { call, changes, fields, routines: () => routines };
}

describe("the routine tools", () => {
	test("save_routine adds a routine to the Workspace of the session's worktree, and changes it by id", async () => {
		const { call, fields, routines } = setup();
		await call("save_routine", { ...fields, id: null });
		const added = routines().find(routine => routine.name === "Nightly triage")!;
		expect(added).toMatchObject({ workspace: OURS, enabled: false, task: { kind: "prompt", prompt: "Triage the issues." } });
		expect(added.launch).toBeUndefined();

		await call("save_routine", { ...fields, id: added.id, enabled: true, launch: { model: { provider: "anthropic", id: "claude" }, thinking: "high", skill: null } });
		expect(routines().find(routine => routine.id === added.id)).toMatchObject({ workspace: OURS, enabled: true, launch: { model: { provider: "anthropic", id: "claude" }, thinking: "high", skill: null } });
	});

	test("save_routine marks a routine for every Workspace, keeps the mark when left out, and keeps a copy's template", async () => {
		const copy: RoutineSpec = { id: "copy", workspace: OURS, name: "Theirs", schedules: [{ kind: "every", minutes: 60 }], triggers: [], task: { kind: "prompt", prompt: "Look." }, enabled: true, copyOf: "theirs" };
		const { call, fields, routines } = setup([copy]);
		await call("save_routine", { ...fields, id: null, everyWorkspace: true });
		const template = routines().find(routine => routine.name === "Nightly triage")!;
		expect(template.everyWorkspace).toBe(true);
		await call("save_routine", { ...fields, id: template.id, enabled: true });
		expect(routines().find(routine => routine.id === template.id)).toMatchObject({ enabled: true, everyWorkspace: true });
		await call("save_routine", { ...fields, id: template.id, everyWorkspace: false });
		expect(routines().find(routine => routine.id === template.id)?.everyWorkspace).toBeUndefined();

		await call("save_routine", { ...fields, id: "copy", name: "Renamed copy" });
		expect(routines().find(routine => routine.id === "copy")).toMatchObject({ name: "Renamed copy", copyOf: "theirs" });
	});

	test("refuses to change or delete a routine of another Workspace, changing nothing, and lists this Workspace's routines", async () => {
		const { call, changes, fields } = setup();
		await call("save_routine", { ...fields, id: null });
		changes.length = 0;
		const listed = /No routine of this Workspace has the id (theirs|nope|)\.\nThe routines of \/repos\/app:\n- [\w-]+: Nightly triage \(disabled\)$/;
		expect(call("save_routine", { ...fields, id: "theirs" })).rejects.toThrow(listed);
		expect(call("delete_routine", { id: "theirs" })).rejects.toThrow(listed);
		expect(call("delete_routine", { id: "nope" })).rejects.toThrow(listed);
		expect(call("delete_routine", { id: "" })).rejects.toThrow(listed);
		await Promise.resolve();
		expect(changes).toEqual([]);
	});

	test("delete_routine deletes a routine of the session's Workspace", async () => {
		const { call, fields, routines } = setup();
		await call("save_routine", { ...fields, id: null });
		const { id } = routines().find(routine => routine.workspace === OURS)!;
		expect(await call("delete_routine", { id })).toBe(`Deleted routine "Nightly triage".\n${OURS} has no routines.`);
		expect(routines().map(routine => routine.id)).toEqual(["theirs"]);
	});

	test("refuses a routine that is not valid, and a caller not listed yet", async () => {
		const { call, fields } = setup();
		expect(call("save_routine", { ...fields, id: null, schedules: [], triggers: [] })).rejects.toThrow("The routine is not valid");
		expect(call("save_routine", { ...fields, id: null }, "i9")).rejects.toThrow("This session is not listed yet");
	});
});
