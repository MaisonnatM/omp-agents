import { Check, ChevronsUpDown, Folder } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { InputMessage } from "@/components/ui/input-message";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Launch } from "../use-dashboard";
import { DirectCommandNote, directCommandOf, Header } from "./conversation";
import { projectName } from "./roster";

interface DirectoryPickerProps {
	cwd: string;
	workspaces: { cwd: string; cwdDisplay: string }[];
	disabled: boolean;
	onPick: (cwd: string) => void;
}

/** The directory the session starts in: one a session ran in, or any directory typed into the search field. */
function DirectoryPicker({ cwd, workspaces, disabled, onPick }: DirectoryPickerProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const typed = query.trim();
	const pick = (next: string): void => {
		setOpen(false);
		setQuery("");
		if (next !== cwd) onPick(next);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="compact"
					leadingIcon={Folder}
					trailingIcon={ChevronsUpDown}
					title={cwd}
					aria-label={`Working directory: ${cwd}`}
					active={open}
					disabled={disabled}
					className="min-w-0"
				>
					<span className="truncate">{projectName(cwd) ?? cwd}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
				<Command>
					<CommandInput aria-label="Search or type a directory" placeholder="Search or type a directory…" value={query} onValueChange={setQuery} />
					<CommandList>
						{typed && !workspaces.some(w => w.cwd === typed || w.cwdDisplay === typed) && (
							<CommandGroup>
								<CommandItem value={typed} onSelect={() => pick(typed)}>
									<span className="truncate">
										Use <span className="font-mono">{typed}</span>
									</span>
								</CommandItem>
							</CommandGroup>
						)}
						<CommandGroup heading="Directories sessions ran in">
							{workspaces.map(workspace => (
								<CommandItem key={workspace.cwd} value={workspace.cwd} keywords={[workspace.cwdDisplay]} onSelect={() => pick(workspace.cwdDisplay)}>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{projectName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</span>
										<span className="truncate text-xs text-muted-foreground">{workspace.cwdDisplay}</span>
									</span>
									<Check className={cn("ml-auto shrink-0", workspace.cwdDisplay === cwd || workspace.cwd === cwd ? "opacity-100" : "opacity-0")} />
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

interface NewSessionProps {
	/** Where omp starts, as typed or displayed (`~/code/webapp`). */
	cwd: string;
	/** Directories sessions ran in, as {@link workspaces} lists them. */
	workspaces: { cwd: string; cwdDisplay: string }[];
	launch: Launch;
	connected: boolean;
	onPickCwd: (cwd: string) => void;
	/** Start omp in `cwd` with `prompt` as its first message. */
	onStart: (prompt: string) => void;
}

/**
 * A session not started yet: a composer and the directory it will run in. omp starts only when the first message is
 * sent, so leaving the draft leaves nothing running. The message stays in the composer until the session opens.
 */
export function NewSession({ cwd, workspaces, launch, connected, onPickCwd, onStart }: NewSessionProps) {
	const [draft, setDraft] = useState("");
	const starting = launch.phase === "starting";
	const directCommand = directCommandOf(draft);
	const name = projectName(cwd) ?? cwd;
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title="New session" meta={<span title={cwd}>{cwd}</span>} status={starting ? "Starting omp…" : undefined} />
			{launch.phase === "failed" && (
				<p role="alert" className="border-b border-border px-6 py-2 text-xs text-red-600 dark:text-red-400">
					{launch.error}
				</p>
			)}
			<p className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground">omp starts in {name} when you send the first message.</p>
			<div className="relative mx-auto w-full max-w-3xl px-6 pb-5">
				<InputMessage
					value={draft}
					onValueChange={setDraft}
					onSend={text => {
						if (!directCommand) onStart(text);
					}}
					leftSlot={<DirectoryPicker cwd={cwd} workspaces={workspaces} disabled={starting} onPick={onPickCwd} />}
					placeholder={`Message a new session in ${name}…`}
					disabled={starting || !connected}
					sendLabel="Start session"
					textareaProps={{ autoFocus: true }}
				/>
				{directCommand && <DirectCommandNote kind={directCommand} />}
			</div>
		</div>
	);
}
