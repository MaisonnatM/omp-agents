// Projects: a session in an omp-agents dashboard project gets its brief, the goal, plan, decisions, and newest log
// lines, at its first prompt and again whenever the project changed since, and two tools.
// `project_list` lists every project; `project_update` makes any change the Projects page makes, on any project:
// create, rename, set the goal, archive, restore, edit the plan and the decisions, log, and join or leave.
// Changes go to the dashboard's project inbox, one file each, which the dashboard server applies and deletes, so it
// stays the only writer of project-list.json and a change left while it is down waits for it.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CONFIG_DIR, inbox, readJson, reply } from "./inbox/client";
import { briefText, findDecision, findProject, findStep, listText, MAX_NAME, MAX_TEXT, type Project, type ProjectChange, projectOfSession, projectsIn, withWaiting } from "./project/brief";

const LIST_FILE = join(CONFIG_DIR, "project-list.json");
const INBOX = inbox<ProjectChange>(join(CONFIG_DIR, "project-inbox"));
const BRIEF_TYPE = "omp-agents.project";
const TOOLS = ["project_list", "project_update"];

/** Every project, counting the changes the dashboard has not applied yet. */
const allProjects = (): Project[] => withWaiting(projectsIn(readJson(LIST_FILE)), INBOX.waiting());

/** `text` on one line. */
const oneLine = (text: string | undefined): string => text?.replace(/\s+/g, " ").trim() ?? "";

export default function project(pi: ExtensionAPI) {
	// The brief this session last got, so a prompt sends it again only once the project changed.
	let briefed: string | null = null;
	// A project's plan is the user's session's to keep, so a subagent's requests leave out these tools' schemas.
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.kind === "sub") await pi.setActiveTools(pi.getActiveTools().filter(name => !TOOLS.includes(name)));
	});
	const z = pi.zod;
	pi.registerTool({
		loadMode: "essential",
		name: "project_list",
		label: "Project list",
		description: "List every omp-agents dashboard project: its name, id, whether it is archived, its progress, and its goal.",
		parameters: z.object({}),
		async execute(_id, _raw, _signal, _onUpdate, ctx) {
			return reply(listText(allProjects(), ctx.sessionManager.getSessionId()));
		},
	});
	const update = z.object({
		action: z
			.enum(["create", "rename", "set_goal", "archive", "restore", "add_step", "edit_step", "tick", "untick", "remove_step", "add_decision", "remove_decision", "log", "join", "leave"])
			.describe("the change to make"),
		projectId: z.string().max(MAX_NAME).optional().describe("the project's id or name, from project_list; defaults to this session's project"),
		name: z.string().max(MAX_NAME).optional().describe("create, rename: the project's name"),
		goal: z.string().max(MAX_TEXT).optional().describe("create, set_goal: the project's goal; empty clears it"),
		step: z.string().max(MAX_TEXT).optional().describe("edit_step, tick, untick, remove_step: the step's number in the brief's plan, such as 2 or 2.1, or its exact text"),
		parent: z.string().max(MAX_TEXT).optional().describe("add_step: the top-level step to add it under as a sub-step, by number or exact text; a plan nests two levels at most"),
		text: z.string().max(MAX_TEXT).optional().describe("add_step, edit_step, add_decision, log: one line; remove_decision: the decision's number in the brief, or its exact text"),
		join: z.boolean().optional().describe("create: also put this session in the new project"),
		sessionId: z.string().max(MAX_NAME).optional().describe("join, leave: the session to move; defaults to this session"),
	});
	pi.registerTool({
		loadMode: "essential",
		name: "project_update",
		label: "Project update",
		description: [
			"Change any omp-agents dashboard project, as its page does; a session is in one project at most, so join leaves any other.",
			"When you finish a step of your project's plan, tick it and log one line on what you did.",
			"Record a decision the user settles with add_decision, and add a step only for work the plan is missing.",
		].join(" "),
		parameters: update,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = update.safeParse(raw);
			if (!parsed.success) return reply("Invalid project_update input.", true);
			const input = parsed.data;
			const { action } = input;
			const sessionId = ctx.sessionManager.getSessionId();
			const line = oneLine(input.text);
			if (action === "create") {
				const name = oneLine(input.name);
				if (!name) return reply("create needs a name.", true);
				const id = randomUUID();
				INBOX.leave({ op: "create", id, name, goal: input.goal?.trim() ?? "", at: new Date().toISOString() });
				if (input.join) INBOX.leave({ op: "join", projectId: id, sessionId });
				return reply(`Created the project ${name} (id ${id})${input.join ? ", and this session joined it" : ""}.`);
			}
			if (action === "leave") {
				INBOX.leave({ op: "leave", sessionId: input.sessionId ?? sessionId });
				return reply(`${input.sessionId ? `Session ${input.sessionId}` : "This session"} left its project.`);
			}
			const projects = allProjects();
			const current = input.projectId ? null : projectOfSession(projects, sessionId);
			const found = input.projectId ? findProject(projects, input.projectId) : current ? { project: current } : { error: "This session is in no open project; name one with projectId, from project_list." };
			if ("error" in found) return reply(found.error, true);
			const { project: target } = found;
			const projectId = target.id;
			switch (action) {
				case "rename": {
					const name = oneLine(input.name);
					if (!name) return reply("rename needs a name.", true);
					INBOX.leave({ op: "rename", projectId, name });
					return reply(`Renamed ${target.name} to ${name}.`);
				}
				case "set_goal": {
					if (input.goal === undefined) return reply("set_goal needs a goal.", true);
					INBOX.leave({ op: "set-goal", projectId, goal: input.goal.trim() });
					return reply(`Set the goal of ${target.name}.`);
				}
				case "archive":
					INBOX.leave({ op: "archive", projectId, at: new Date().toISOString() });
					return reply(`Archived ${target.name}.`);
				case "restore":
					INBOX.leave({ op: "restore", projectId });
					return reply(`Restored ${target.name}.`);
				case "add_step": {
					if (!line) return reply("add_step needs text.", true);
					const parent = input.parent ? findStep(target, input.parent) : undefined;
					if (parent === null) return reply(`No step "${input.parent}" in the plan of ${target.name}.`, true);
					if (parent?.parentId !== undefined) return reply(`"${parent.text}" is a sub-step, which holds no steps of its own: a plan nests two levels at most.`, true);
					INBOX.leave({ op: "add-step", projectId, stepId: randomUUID(), text: line, ...(parent ? { parentId: parent.id } : {}) });
					return reply(`Added the step "${line}" to ${target.name}${parent ? ` under "${parent.text}"` : ""}.`);
				}
				case "edit_step":
				case "tick":
				case "untick":
				case "remove_step": {
					if (!input.step) return reply(`${action} needs the step's number or text.`, true);
					const step = findStep(target, input.step);
					if (!step) return reply(`No step "${input.step}" in the plan of ${target.name}.`, true);
					if (action === "remove_step") {
						INBOX.leave({ op: "remove-step", projectId, stepId: step.id });
						return reply(`Removed the step "${step.text}" from ${target.name}.`);
					}
					if (action === "edit_step") {
						if (!line) return reply("edit_step needs text.", true);
						INBOX.leave({ op: "edit-step", projectId, stepId: step.id, text: line });
						return reply(`Changed the step "${step.text}" to "${line}".`);
					}
					INBOX.leave({ op: "set-step", projectId, stepId: step.id, done: action === "tick" });
					return reply(`${action === "tick" ? "Ticked" : "Unticked"} "${step.text}".`);
				}
				case "add_decision": {
					if (!line) return reply("add_decision needs text.", true);
					INBOX.leave({ op: "add-decision", projectId, text: line });
					return reply(`Recorded the decision in ${target.name}.`);
				}
				case "remove_decision": {
					if (!line) return reply("remove_decision needs the decision's number or text.", true);
					const decision = findDecision(target, line);
					if (decision === null) return reply(`No decision "${line}" in ${target.name}.`, true);
					INBOX.leave({ op: "remove-decision", projectId, text: decision });
					return reply(`Removed the decision "${decision}" from ${target.name}.`);
				}
				case "log": {
					if (!line) return reply("log needs text.", true);
					INBOX.leave({ op: "log", projectId, at: new Date().toISOString(), sessionId, text: line });
					return reply(`Logged to ${target.name}.`);
				}
				case "join": {
					const who = input.sessionId ?? sessionId;
					INBOX.leave({ op: "join", projectId, sessionId: who });
					if (who !== sessionId) return reply(`Put session ${who} in ${target.name}.`);
					briefed = briefText(target, sessionId);
					return reply(`Joined ${target.name}.\n\n${briefed}`);
				}
			}
		},
	});
	pi.on("before_agent_start", (event, ctx) => {
		if (event.reason === "revive" || ctx.agent.kind === "sub" || ctx.mode === "print" || ctx.mode === "json") return;
		const sessionId = ctx.sessionManager.getSessionId();
		const current = projectOfSession(allProjects(), sessionId);
		const brief = current && briefText(current, sessionId);
		if (!brief || brief === briefed) return;
		briefed = brief;
		return { message: { customType: BRIEF_TYPE, content: brief, display: false } };
	});
}
