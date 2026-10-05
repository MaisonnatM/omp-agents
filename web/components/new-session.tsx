import { Check, ChevronsUpDown, Folder, Sparkles } from "lucide-react";
import { useState } from "react";
import type { BranchChoice, ModelOption } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { InputMessage } from "@/components/ui/input-message";
import { projectName } from "../labels";
import type { Completions } from "../pane-store";
import { usePinnedSkill } from "../pinned-skill";
import { useRead } from "../reads";
import { useShortcuts } from "../shortcuts";
import type { NewOp, StartOf } from "../starts";
import { useGitCheckout } from "../use-git-checkout";
import { useDefaultModel } from "../use-default-model";
import { useSkills } from "../use-skills";
import { useCompletion } from "./completion-popup";
import { blockedShortcut, ComposerNote, EmptyConversation, Header } from "./conversation";
import { BranchPicker, chosenBranch, GitRef, targetOf } from "./git";
import { AttachButton, IMAGE_ACCEPT, useImageAttachments } from "./image-attachments";
import { ModelPicker } from "./model-picker";

interface NewSessionProps {
	/** Where omp starts, as typed or displayed (`~/code/webapp`). */
	cwd: string;
	/** Directories sessions ran in, as {@link workspaces} lists them, which the directory picker offers. */
	workspaces: { cwd: string; cwdDisplay: string }[];
	launch: StartOf<"new"> | null;
	connected: boolean;
	/** The server's last answer to this draft's `complete`. */
	completions: Completions | null;
	/** Ask for `/` and `@` suggestions, resolved as a session started in `cwd` would resolve them. */
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** Move the draft to directory `cwd`, as typed or displayed. */
	onPickCwd: (cwd: string) => void;
	/** Start omp with the first message: in `cwd`, or on `branch` when it names one; on `model`, else on omp's default; at `thinking` when it names a level; through `skill` when it names one. */
	onStart: (op: Omit<NewOp, "kind" | "cwd">) => void;
}

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
						{typed && !workspaces.some(w => w.cwd === typed || w.cwdDisplay === typed) && (
							<CommandGroup forceMount>
								<CommandItem forceMount value={`use ${typed}`} onSelect={() => pick(typed)}>
									<span className="truncate">
										Use <span className="font-mono">{typed}</span>
									</span>
								</CommandItem>
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * A session not started yet, with the same composer a live session has. omp starts in `cwd` only when the first message
 * is sent, so leaving the draft leaves nothing running. The message and its images stay in the composer until the session opens.
 * The composer picks the directory, the model, and in a git checkout the branch; another branch than `cwd`'s runs in its own worktree.
 * A skill pinned in the settings shows as a toggle, on until you turn it off for this session.
 */
export function NewSession({ cwd, workspaces, launch, connected, completions, onComplete, onPickCwd, onStart }: NewSessionProps) {
	const [draft, setDraft] = useState("");
	const attachments = useImageAttachments();
	const [picked, setPicked] = useState<{ cwd: string; choice: BranchChoice | null }>({ cwd, choice: null });
	/** The model picked, `null` for omp's default; either way at omp's thinking level. */
	const [model, setModel] = useState<ModelOption | null>(null);
	// Until a pick, omp starts on its `default` role's model, so the picker shows that one.
	const defaultModel = useDefaultModel(cwd);
	const shownModel = model ?? defaultModel;
	const [pinnedSkill] = usePinnedSkill();
	const [skipSkill, setSkipSkill] = useState(false);
	const skills = useSkills(cwd);
	// The server decides whether the skill applies; the toggle only shows what it will decide.
	const skillState: SkillState =
		skills !== null && !skills.skills.some(skill => skill.name === pinnedSkill)
			? "missing"
			: skipSkill
				? "off"
				: draft.trimStart().startsWith("/")
					? "bypassed"
					: "on";
	const [modelsOpen, setModelsOpen] = useState(false);
	// As in a live session, the list is read again on every open, so a login since the last one shows. Before the first
	// open (`modelOpens` 0) nothing is read.
	const [modelOpens, setModelOpens] = useState(0);
	const modelsRead = useRead<{ models: ModelOption[] }>(modelOpens > 0 ? "/api/models/connected" : null, modelOpens);
	const models = modelsRead.error !== null ? { models: [], error: modelsRead.error } : modelsRead.data && { models: modelsRead.data.models, error: null };
	// A failed start can still have added the branch and its worktree, so the picker reads the checkout again.
	const checkout = useGitCheckout(cwd, launch?.phase === "failed" ? launch : null);
	const pickedChoice = picked.cwd === cwd ? picked.choice : null;
	// A new branch that a failed start created is an existing one now, so the next start uses it as such.
	const choice: BranchChoice | null =
		pickedChoice?.kind === "new" && checkout?.branches.some(branch => branch.name === pickedChoice.name)
			? { kind: "existing", name: pickedChoice.name }
			: pickedChoice;
	const completion = useCompletion({ draft, setDraft, completions, onComplete });
	const starting = launch?.phase === "starting";
	const openModels = (open: boolean): void => {
		setModelsOpen(open);
		if (open) setModelOpens(count => count + 1);
	};
	useShortcuts({
		model: () => {
			if (starting) return false;
			openModels(true);
		},
	});
	const directCommand = blockedShortcut(draft, "new");
	const target = checkout ? targetOf(checkout, cwd, choice) : { dir: cwd, creates: false };
	const name = projectName(target.dir) ?? target.dir;
	const meta = (
		<>
			{checkout && (
				<>
					<GitRef github={checkout.github} branch={chosenBranch(checkout, choice)} />
					{" · "}
				</>
			)}
			<span title={target.dir}>{target.creates ? `new worktree ${target.dir}` : target.dir}</span>
		</>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title="New session" meta={meta} status={starting ? "Starting omp…" : undefined} />
			{launch?.phase === "failed" && (
				<p role="alert" className="border-b border-border px-6 py-2 text-xs text-red-600 dark:text-red-400">
					{launch.error}
				</p>
			)}
			<EmptyConversation title={`Start omp in ${name}`}>
				{target.creates
					? "It starts when you send the first message, which adds the worktree, so leaving this draft leaves nothing running."
					: "It starts when you send the first message, so leaving this draft leaves nothing running."}
			</EmptyConversation>
			<div className="relative mx-auto w-full max-w-3xl px-3 pb-5">
				{completion.popup}
				<InputMessage
					ref={completion.composerRef}
					value={draft}
					onValueChange={completion.onValueChange}
					onSend={text => {
						if (directCommand) return;
						completion.close();
						attachments.read(images => onStart({ prompt: text, images, branch: choice, model, skill: skipSkill ? null : pinnedSkill }));
					}}
					placeholder="Message this session…"
					files={attachments.files}
					onFilesChange={attachments.onFilesChange}
					accept={IMAGE_ACCEPT}
					leftSlot={
						<>
							<ModelPicker
								current={shownModel && `${shownModel.provider}/${shownModel.id}`}
								unset="Default model"
								list={models}
								open={modelsOpen}
								onOpenChange={openModels}
								onPick={setModel}
								disabled={starting}
							/>
							<DirectoryPicker cwd={cwd} workspaces={workspaces} disabled={starting} onPick={onPickCwd} />
							{checkout && <BranchPicker checkout={checkout} choice={choice} onChoose={next => setPicked({ cwd, choice: next })} disabled={starting} />}
							{pinnedSkill !== null && <PinnedSkillToggle name={pinnedSkill} state={skillState} onToggle={() => setSkipSkill(skip => !skip)} disabled={starting} />}
						</>
					}
					rightSlot={({ openFilePicker }) => <AttachButton onClick={() => openFilePicker()} disabled={starting} />}
					disabled={starting || !connected}
					sendLabel="Start session"
					textareaProps={{ ...completion.textareaProps, autoFocus: true }}
				/>
				{directCommand && <ComposerNote text={directCommand} />}
				{attachments.note && <ComposerNote text={attachments.note} />}
			</div>
		</div>
	);
}

/** Whether the pinned skill applies: `missing` when the directory has no such skill, `bypassed` when the message opens with its own command. */
type SkillState = "on" | "off" | "missing" | "bypassed";

function skillTitle(name: string, state: SkillState): string {
	switch (state) {
		case "on":
			return `The first message goes through /skill:${name}. Click to start without it.`;
		case "off":
			return `Click to send the first message through /skill:${name}.`;
		case "missing":
			return `No skill named ${name} in this directory, so the session starts without it.`;
		case "bypassed":
			return `A message that starts with / runs its own command, so it skips /skill:${name}.`;
		default: {
			const unhandled: never = state;
			return unhandled;
		}
	}
}

/** The skill pinned in the settings, as a toggle in the draft's composer: while on, the first message goes through it. */
function PinnedSkillToggle({ name, state, onToggle, disabled }: { name: string; state: SkillState; onToggle: () => void; disabled: boolean }) {
	return (
		<Button
			variant="ghost"
			size="compact"
			leadingIcon={Sparkles}
			aria-pressed={state === "on"}
			aria-label={`Pinned skill ${name}`}
			title={skillTitle(name, state)}
			onClick={onToggle}
			disabled={disabled || state === "missing" || state === "bypassed"}
		>
			<span className={cn("max-w-40 truncate", state !== "on" && "text-muted-foreground line-through")}>{name}</span>
		</Button>
	);
}
