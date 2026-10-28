/** The Settings Workflows section: the skills tagged `workflow`, each with how to start it, viewed and edited in place (`Workflows`). */
import { useState } from "react";
import { SessionVisual } from "../session-visual";
import type { OmpFile, Workflow } from "../../../src/shared/models";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Editing } from "./editor";
import { FileView } from "./files-tab";

const TAG_SNIPPET = "metadata:\n  tags: workflow";

/** What a session types to start `workflow`: its own command when one exists, else the skill. */
const invocation = (workflow: Workflow): string => (workflow.command ? `/${workflow.name}` : `/skill:${workflow.name}`);

/** The skill's steps, its top-level `1. **Title.**` items, in order. */
export function workflowSteps(text: string): string[] {
	return [...text.matchAll(/^\d+\. \*\*(.+?)\.?\*\*/gm)].map(match => match[1]!.trim());
}

/** The steps as a top-to-bottom mermaid flowchart; `null` under two steps. */
export function stepsFlowchart(steps: string[]): string | null {
	if (steps.length < 2) return null;
	const nodes = steps.map((step, i) => `  s${i}["${i + 1}. ${step.replaceAll('"', "'")}"]`);
	return ["flowchart TD", ...nodes, `  ${steps.map((_, i) => `s${i}`).join(" --> ")}`].join("\n");
}

export function Workflows({ workflows, files, editing }: { workflows: Workflow[]; files: OmpFile[]; editing: Editing }) {
	const [selected, setSelected] = useState<string | null>(null);
	const listed = workflows.flatMap(workflow => {
		const skill = files.find(file => file.path === workflow.skill);
		return skill ? [{ workflow, skill }] : [];
	});
	const open = listed.find(({ skill }) => skill.path === selected) ?? listed[0];
	if (!open) {
		return (
			<div className="max-w-prose space-y-3 text-sm text-muted-foreground">
				<p>omp found no workflows. A workflow is a skill whose SKILL.md frontmatter tags it, with these two lines:</p>
				<pre className="w-fit rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-foreground">{TAG_SNIPPET}</pre>
				<p>
					A command of the same name, such as <code>commands/ship.md</code> for a <code>ship</code> skill, starts it as <code>/ship</code>; without one, start it as <code>/skill:ship</code>.
				</p>
			</div>
		);
	}
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<nav aria-label="omp workflows">
				<ul>
					{listed.map(({ workflow, skill }) => (
						<li key={skill.path}>
							<Tooltip content={workflow.description || skill.pathDisplay}>
								<button
									type="button"
									aria-current={skill === open.skill ? "true" : undefined}
									onClick={() => setSelected(skill.path)}
									className={cn(
										"flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
										skill === open.skill && "bg-muted font-medium",
									)}
								>
									<span className="flex w-full items-baseline gap-2">
										<span className="truncate">{workflow.name}</span>
										<span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{skill.scope}</span>
									</span>
									<span className="truncate font-mono text-xs font-normal text-muted-foreground">{invocation(workflow)}</span>
								</button>
							</Tooltip>
						</li>
					))}
				</ul>
			</nav>
			<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
				<StepsChart key={open.skill.path} file={open.skill} />
				<FileView key={open.skill.path} file={open.skill} editing={editing} />
			</div>
		</div>
	);
}

function StepsChart({ file }: { file: OmpFile }) {
	const source = file.body.state === "read" ? stepsFlowchart(workflowSteps(file.body.text)) : null;
	return source ? <SessionVisual language="mermaid" source={source} code={source} /> : null;
}
