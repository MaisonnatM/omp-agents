import * as DialogPrimitive from "@radix-ui/react-dialog";
import { defaultFilter } from "cmdk";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from "react";
import type { PastSession, RosterHost, View } from "../../src/shared";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { age, hostLabel, pastLabel } from "../labels";
import { IS_MAC } from "../shortcuts";
import { StatusDot } from "./status-dot";

const CREATE_TODO = "create-todo";

/** cmdk's own match for a session. Create todo matches whatever is typed, with the lowest score, so it lists last and Enter opens the best session first. */
const matches = (value: string, search: string, keywords?: string[]): number => (value === CREATE_TODO ? Number.MIN_VALUE : defaultFilter(value, search, keywords));

interface SessionSwitcherProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	hosts: RosterHost[];
	past: PastSession[];
	/** Open `view` in the focused pane. `cwd` is its session's directory. */
	onPick: (view: View, cwd: string) => void;
	/**
	 * Add a top-level todo titled with what was typed. Omitted while the list cannot be edited, which hides the action.
	 * Enter opens the highlighted session, which is Create todo when no session matches. ⌘Enter (Ctrl+Enter off macOS) always creates the todo.
	 */
	onCreateTodo?: (text: string) => void;
}

/** Finds any running or past session by its title or directory, in every project, and opens it in the focused pane. What you type can also become a todo. */
export function SessionSwitcher({ open, onOpenChange, hosts, past, onPick, onCreateTodo }: SessionSwitcherProps) {
	const [query, setQuery] = useState("");
	const title = query.trim();
	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);
	const pick = (view: View, cwd: string): void => {
		onOpenChange(false);
		onPick(view, cwd);
	};
	const create = (): void => {
		if (!onCreateTodo || !title) return;
		onCreateTodo(title);
		onOpenChange(false);
	};
	const createOnChordEnter = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
		if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
		event.preventDefault();
		create();
	};
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="fixed top-[15vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden"
				>
					<DialogPrimitive.Title className="sr-only">Jump to a session, or create a todo</DialogPrimitive.Title>
					<Command filter={matches}>
						<CommandInput aria-label="Search sessions or type a todo" placeholder="Search sessions, or type a todo…" value={query} onValueChange={setQuery} onKeyDown={createOnChordEnter} />
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
							{onCreateTodo && title && (
								<CommandGroup>
									<CommandItem value={CREATE_TODO} onSelect={create}>
										<span className="shrink-0">Create todo</span>
										<span className="min-w-0 flex-1 truncate text-muted-foreground">{title}</span>
										<CommandShortcut>{IS_MAC ? "⌘↵" : "Ctrl+Enter"}</CommandShortcut>
									</CommandItem>
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
