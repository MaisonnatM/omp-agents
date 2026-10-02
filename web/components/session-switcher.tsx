import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { PastSession, RosterHost, View } from "../../src/shared";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { age, hostLabel, pastLabel } from "../labels";
import { StatusDot } from "./status-dot";

interface SessionSwitcherProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	hosts: RosterHost[];
	past: PastSession[];
	/** Open `view` in the focused pane. `cwd` is its session's directory. */
	onPick: (view: View, cwd: string) => void;
}

/** Finds any running or past session by its title or directory, in every project, and opens it in the focused pane. */
export function SessionSwitcher({ open, onOpenChange, hosts, past, onPick }: SessionSwitcherProps) {
	const pick = (view: View, cwd: string): void => {
		onOpenChange(false);
		onPick(view, cwd);
	};
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="fixed top-[15vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden"
				>
					<DialogPrimitive.Title className="sr-only">Jump to a session</DialogPrimitive.Title>
					<Command>
						<CommandInput aria-label="Search sessions" placeholder="Search sessions by title or directory…" />
						<CommandList className="max-h-[min(24rem,60vh)]">
							<CommandEmpty>No session matches.</CommandEmpty>
							{hosts.length > 0 && (
								<CommandGroup heading="Running">
									{hosts.map(host => (
										<CommandItem
											key={host.instanceId}
											value={`live ${host.instanceId}`}
											keywords={[hostLabel(host), host.cwdDisplay]}
											onSelect={() => pick({ kind: "live", instanceId: host.instanceId, agentId: null }, host.cwd)}
										>
											<StatusDot status={host.status} />
											<Row label={hostLabel(host)} cwd={host.cwdDisplay} when={age(host.startedAt)} />
										</CommandItem>
									))}
								</CommandGroup>
							)}
							{past.length > 0 && (
								<CommandGroup heading="Past">
									{past.map(session => (
										<CommandItem
											key={session.sessionId}
											value={`past ${session.sessionId}`}
											keywords={[pastLabel(session), session.cwdDisplay]}
											onSelect={() => pick({ kind: "past", sessionId: session.sessionId }, session.cwd)}
										>
											<Row label={pastLabel(session)} cwd={session.cwdDisplay} when={age(session.modifiedAt)} />
										</CommandItem>
									))}
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function Row({ label, cwd, when }: { label: string; cwd: string; when: string }) {
	return (
		<>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate">{label}</span>
				<span className="truncate text-xs text-muted-foreground">{cwd}</span>
			</span>
			<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span>
		</>
	);
}
