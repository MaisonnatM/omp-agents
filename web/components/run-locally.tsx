/** `RunLocallyButton`: the **Run locally** button of a session header and a pull request row, and the run profile it asks for. */
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { MAX_RUN_SERVICES, type RunOutcome, type RunProfile } from "../../src/shared/run-locally";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { runLocally } from "../api";
import { useRead } from "../reads";
import { useAction } from "../use-action";
import { useDashboardActions } from "./dashboard-context";
import { toasts } from "./toaster";

const FIELD = "w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** What the toast says a run did: where it runs, the worktree it removed or kept, the install, and the services it stopped. */
function outcomeText(branch: string, outcome: RunOutcome): { title: string; description: string } {
	const notes: string[] = [];
	if (outcome.release.kind === "removed") notes.push(`Removed worktree ${outcome.release.path}.`);
	if (outcome.release.kind === "kept") notes.push(`Kept its worktree: ${outcome.release.why}`);
	if (outcome.installed) notes.push("Installed dependencies.");
	if (outcome.stopped) notes.push(`Stopped ${outcome.stopped} service${outcome.stopped === 1 ? "" : "s"} of the previous run.`);
	return { title: `Running ${branch} in ${outcome.dir}`, description: notes.join(" ") };
}

interface RunLocallyButtonProps {
	/** A directory in the repository. */
	cwd: string;
	branch: string;
	className?: string;
}

/**
 * Runs `branch` locally: its popover shows the repository's run profile, the services one line each and the install
 * command, which **Run** saves before it frees the branch, checks it out in the main checkout, and starts each service in
 * a terminal tab.
 */
export function RunLocallyButton({ cwd, branch, className }: RunLocallyButtonProps) {
	const [open, setOpen] = useState(false);
	const { revealTerminals } = useDashboardActions();
	const read = useRead<RunProfile>(open ? `/api/run-profile?${new URLSearchParams({ cwd })}` : null);
	const [services, setServices] = useState<string | null>(null);
	const [install, setInstall] = useState<string | null>(null);
	useEffect(() => {
		if (open) return;
		setServices(null);
		setInstall(null);
	}, [open]);
	const shownServices = services ?? read.data?.services.join("\n") ?? "";
	const shownInstall = install ?? read.data?.install ?? "";
	const lines = shownServices.split("\n").filter(line => line.trim() !== "");
	const start = useAction(async () => {
		const outcome = await runLocally({ cwd, branch, profile: { install: shownInstall, services: lines } });
		setOpen(false);
		toasts.add(outcomeText(branch, outcome));
		revealTerminals(outcome.terminals);
	}, `Could not run ${branch} locally`);
	const label = `Run ${branch} locally`;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content={label} forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="icon-compact" aria-label={label} loading={start.pending} active={open} className={cn("text-muted-foreground", className)}>
						<Play />
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent align="end" className="w-80 space-y-3 p-3">
				<form
					className="space-y-3"
					onSubmit={event => {
						event.preventDefault();
						start.run();
					}}
				>
					<p className="text-[13px]">
						Frees <span className="font-mono">{branch}</span> from its worktree, checks it out in the main checkout, and starts each service in a terminal tab.
					</p>
					<label className="block space-y-1 text-xs text-muted-foreground">
						<span>Services, one command per line</span>
						<textarea rows={3} value={shownServices} placeholder="npm run dev" readOnly={start.pending} onChange={event => setServices(event.target.value)} className={cn(FIELD, "resize-y text-foreground")} />
					</label>
					<label className="block space-y-1 text-xs text-muted-foreground">
						<span>Install, when a lockfile changed</span>
						<input value={shownInstall} placeholder="npm install" readOnly={start.pending} onChange={event => setInstall(event.target.value)} className={cn(FIELD, "text-foreground")} />
					</label>
					{read.error && <p className="text-xs text-red-600 dark:text-red-400">Cannot read the run profile: {read.error}</p>}
					<div className="flex items-center justify-end gap-2">
						<span className="mr-auto text-xs text-muted-foreground">{lines.length > MAX_RUN_SERVICES ? `At most ${MAX_RUN_SERVICES} services` : "Saved for the repository"}</span>
						<Button type="submit" size="compact" loading={start.pending} disabled={lines.length === 0 || lines.length > MAX_RUN_SERVICES}>
							{start.pending ? "Running…" : "Run"}
						</Button>
					</div>
				</form>
			</PopoverContent>
		</Popover>
	);
}
