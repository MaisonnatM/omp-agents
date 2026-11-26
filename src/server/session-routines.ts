/**
 * The `save_routine` and `delete_routine` tools a dashboard session gets, which add, change, and delete the routines of
 * the Workspace the session works in, as the Routines tab of that Workspace's Board would. A routine of another
 * Workspace is out of reach, and a new one gets the session's Workspace.
 */
import { randomUUID } from "node:crypto";
import type { RpcHostTool } from "../omp/module-types/rpc";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { MAX_PROMPT_LENGTH, parseRoutineSpec, type Routine, type RoutineChange, TRIGGER_KINDS } from "../routines";
import type { RosterHost } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const SAVE_ROUTINE_TOOL = "save_routine";
export const DELETE_ROUTINE_TOOL = "delete_routine";

export interface SessionRoutinesDeps {
	/** The live sessions' roster rows, which give the caller's directory. */
	hosts(): RosterHost[];
	/** The Workspace directory `cwd` belongs to: its repository's main checkout, or `cwd` outside git. */
	workspaceOf(cwd: string): Promise<string>;
	routines(): readonly Routine[];
	/** Saves `change` to the routines and tells every page. */
	apply(change: Exclude<RoutineChange, { op: "run-now" }>): void;
}

export class SessionRoutines {
	readonly #deps: SessionRoutinesDeps;

	constructor(deps: SessionRoutinesDeps) {
		this.#deps = deps;
	}

	/** How session `instanceId` joins the server: with its own routine tools. */
	join(instanceId: string): SessionJoin {
		return { rpc: { ...PLAIN_LAUNCH, tools: [this.#saveTool(instanceId), this.#deleteTool(instanceId)] }, attach() {} };
	}

	/** The Workspace of session `caller`'s directory; throws while the session is not listed. */
	async #workspace(caller: string): Promise<string> {
		const host = this.#deps.hosts().find(row => row.instanceId === caller);
		if (!host) throw new Error("This session is not listed yet; try again in a moment.");
		return this.#deps.workspaceOf(host.cwd);
	}

	/** The routines of `workspace`, one line each with its id and name, as every result and refusal lists them. */
	#listed(workspace: string): string {
		const own = this.#deps.routines().filter(routine => routine.workspace === workspace);
		if (own.length === 0) return `${workspace} has no routines.`;
		return [`The routines of ${workspace}:`, ...own.map(routine => `- ${routine.id}: ${routine.name}${routine.enabled ? "" : " (disabled)"}`)].join("\n");
	}

	/** Routine `id` of `workspace`; throws, listing that Workspace's routines, when none of them has that id. */
	#own(id: unknown, workspace: string): Routine {
		const routine = this.#deps.routines().find(candidate => candidate.id === id && candidate.workspace === workspace);
		if (!routine) throw new Error(`No routine of this Workspace has the id ${String(id)}.\n${this.#listed(workspace)}`);
		return routine;
	}

	#saveTool(caller: string): RpcHostTool {
		return {
			name: SAVE_ROUTINE_TOOL,
			label: "Save routine",
			description: [
				"Add a routine to the Workspace this session works in, or change one of its routines, as the user would on the Routines tab of that Workspace's Board.",
				"On its schedules, or when its triggers see something happen, a run posts a Board task in the Workspace with the routine's prompt, and a fresh session works on it; while the routine's last Board task is not done, a run replies on it instead.",
				"A command routine runs its shell command in the Workspace first and posts its prompt and the command's report, as its `post` rule allows: always, only failures, or only when the output changed.",
				"Each result, and each refusal of an unknown `id`, lists the Workspace's routines by id and name; to list them without changing anything, call `delete_routine` with an empty `id`. Pass null as `id` to add one.",
				"Save only what the user asked for; a new routine is disabled unless they asked to turn it on.",
				"`everyWorkspace: true` also copies the routine into every Workspace the user works in that lacks it, now and as new ones appear; each copy is its own routine, which later edits here do not change. Leave it out to keep the routine's current setting.",
			].join(" "),
			parameters: {
				type: "object",
				properties: {
					id: { type: ["string", "null"], description: "The id of the routine to change; null to add a routine." },
					name: { type: "string" },
					enabled: { type: "boolean" },
					schedules: {
						type: "array",
						description: 'Each `{"kind":"every","minutes":n}`, or `{"kind":"weekly","days":[0-6, Sunday is 0; all seven for daily],"time":{"hour":h,"minute":m}}`, in local time.',
						items: { type: "object" },
					},
					triggers: { type: "array", description: `Each \`{"kind":k}\`, k one of ${TRIGGER_KINDS.map(kind => `"${kind}"`).join(", ")}: a Slack message that waits on the user, or a pull request of the Workspace whose status changes. A routine has at least one schedule or trigger.`, items: { type: "object" } },
					task: {
						type: "object",
						description: `\`{"kind":"prompt","prompt":text}\`, or \`{"kind":"command","command":sh,"post":"failures"|"changes" (omit to post every run),"prompt":text (optional)}\`. A prompt is at most ${MAX_PROMPT_LENGTH} characters.`,
					},
					launch: { type: ["object", "null"], description: 'null for omp\'s defaults, or `{"model":{"provider":p,"id":m} or null,"thinking":level or null,"skill":name or null}` for the sessions on its Board tasks.' },
					everyWorkspace: { type: "boolean", description: "Whether to add this routine to every new Workspace; omit to keep its current setting, off for a new routine." },
				},
				required: ["id", "name", "enabled", "schedules", "triggers", "task", "launch"],
				additionalProperties: false,
			},
			loadMode: "essential",
			execute: async args => {
				const workspace = await this.#workspace(caller);
				const stored = args.id === null || args.id === undefined ? null : this.#own(args.id, workspace);
				const id = stored?.id ?? randomUUID();
				// A copy stays a copy of its template; `everyWorkspace` left out keeps what the routine had.
				const parsed = parseRoutineSpec({ ...args, id, workspace, launch: args.launch ?? undefined, everyWorkspace: args.everyWorkspace ?? stored?.everyWorkspace, copyOf: stored?.copyOf });
				if (!parsed) throw new Error("The routine is not valid: check every field against this tool's description.");
				this.#deps.apply({ op: "save", routine: parsed.ok });
				return `Saved routine "${parsed.ok.name}" (id ${id}) in ${workspace}, ${parsed.ok.enabled ? "enabled" : "disabled"}.\n${this.#listed(workspace)}`;
			},
		};
	}

	#deleteTool(caller: string): RpcHostTool {
		return {
			name: DELETE_ROUTINE_TOOL,
			label: "Delete routine",
			description: "Delete a routine of the Workspace this session works in, by its `id`. The result, and the refusal of an unknown `id`, lists the Workspace's routines by id and name, so an empty `id` lists them and deletes nothing. Delete only a routine the user asked you to delete.",
			parameters: {
				type: "object",
				properties: { id: { type: "string", description: "The id of the routine to delete." } },
				required: ["id"],
				additionalProperties: false,
			},
			loadMode: "essential",
			execute: async ({ id }) => {
				const workspace = await this.#workspace(caller);
				const routine = this.#own(id, workspace);
				this.#deps.apply({ op: "remove", id: routine.id });
				return `Deleted routine "${routine.name}".\n${this.#listed(workspace)}`;
			},
		};
	}
}
