/** The Settings Workflows section: the skills tagged `workflow`, each with how to start it, viewed and edited in place (`Workflows`). */
import { useState } from "react";
import type { Workflow } from "../../../src/shared/models";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Editing } from "./editor";
import { FileView } from "./files-tab";

const TAG_SNIPPET = "metadata:\n  tags: workflow";

/** What a session types to start `workflow`: its own command when one exists, else the skill. */
const invocation = (workflow: Workflow): string => (workflow.command ? `/${workflow.name}` : `/skill:${workflow.name}`);

export function Workflows({ workflows, editing }: { workflows: Workflow[]; editing: Editing }) {
	const [selected, setSelected] = useState<string | null>(null);
	const open = workflows.find(workflow => workflow.skill.path === selected) ?? workflows[0];
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
			<nav aria-label="Workflows">
				<ul>
					{workflows.map(workflow => (
						<li key={workflow.skill.path}>
							<Tooltip content={workflow.description || workflow.skill.pathDisplay}>
								<button
									type="button"
									aria-current={workflow === open ? "true" : undefined}
									onClick={() => setSelected(workflow.skill.path)}
									className={cn(
										"flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
										workflow === open && "bg-muted font-medium",
									)}
								>
									<span className="flex w-full items-baseline gap-2">
										<span className="truncate">{workflow.name}</span>
										<span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{workflow.skill.scope}</span>
									</span>
									<span className="truncate font-mono text-xs font-normal text-muted-foreground">{invocation(workflow)}</span>
								</button>
							</Tooltip>
						</li>
					))}
				</ul>
			</nav>
			<FileView key={open.skill.path} file={open.skill} editing={editing} />
		</div>
	);
}
