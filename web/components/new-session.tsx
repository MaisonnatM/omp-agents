import { Folder, Sparkles } from "lucide-react";
import { useState } from "react";
import type { BranchChoice, ConnectedModels, ModelOption } from "../../src/shared";
import { Button } from "@/components/ui/button";
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
import { CommandPicker } from "./command-picker";
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
	const [query, setQuery] = useState("");
	const typed = query.trim();
	const pick = (next: string): void => {
		if (next !== cwd) onPick(next);
	};
	return (
		<CommandPicker
			trigger={<span className="truncate">{projectName(cwd) ?? cwd}</span>}
			icon={Folder}
			ariaLabel={`Working directory: ${cwd}`}
			tooltip={cwd}
			disabled={disabled}
			className="min-w-0"
			search={{ label: "Search or type a directory", query: { value: query, onChange: setQuery } }}
			width="lg"
			side="top"
			onOpenChange={next => {
				if (!next) setQuery("");
			}}
			list={{
				kind: "ready",
				groups: [
					{
						key: "workspaces",
						heading: "Directories sessions ran in",
						items: workspaces.map(workspace => ({
							value: workspace.cwd,
							keywords: [workspace.cwdDisplay],
							label: (
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{projectName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</span>
									<span className="truncate text-xs text-muted-foreground">{workspace.cwdDisplay}</span>
								</span>
							),
							selected: workspace.cwdDisplay === cwd || workspace.cwd === cwd,
							onSelect: () => pick(workspace.cwdDisplay),
						})),
					},
					...(typed && !workspaces.some(w => w.cwd === typed || w.cwdDisplay === typed)
						? [
								{
									key: "typed",
									forceMount: true,
									items: [
										{
											value: `use ${typed}`,
											label: (
												<span className="truncate">
													Use <span className="font-mono">{typed}</span>
												</span>
											),
											onSelect: () => pick(typed),
										},
									],
								},
							]
						: []),
				],
			}}
		/>
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
	/** `null` leaves omp's default model unchanged. */
	const [model, setModel] = useState<ModelOption | null>(null);
	const [pickedThinking, setPickedThinking] = useState<{ model: string; level: string } | null>(null);
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
	// Reopening reads credentials and model capabilities again after a provider login.
	const [modelOpens, setModelOpens] = useState(0);
	const modelsRead = useRead<ConnectedModels>("/api/models/connected", modelOpens);
	const models = modelsRead.error !== null ? { models: [], error: modelsRead.error } : modelsRead.data && { models: modelsRead.data.models, error: null };
	const shownSelector = shownModel ? `${shownModel.provider}/${shownModel.id}` : null;
	const levels = modelsRead.data?.capabilities.find(({ model }) => `${model.provider}/${model.id}` === shownSelector)?.thinkingLevels ?? null;
	const thinking = pickedThinking?.model === shownSelector && levels?.includes(pickedThinking.level) ? pickedThinking.level : null;
	const pickThinking = (level: string | null): void => {
		setPickedThinking(level !== null && shownSelector ? { model: shownSelector, level } : null);
	};
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
			if (starting || !connected) return false;
			openModels(true);
		},
		thinking: () => {
			if (starting || !connected || modelsRead.error !== null || !levels?.length) return false;
			pickThinking(levels[(levels.indexOf(thinking ?? "") + 1) % levels.length]);
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
						attachments.read(images => onStart({ prompt: text, images, branch: choice, model, thinking, skill: skipSkill ? null : pinnedSkill }));
					}}
					placeholder="Message this session…"
					files={attachments.files}
					onFilesChange={attachments.onFilesChange}
					accept={IMAGE_ACCEPT}
					leftSlot={
						<>
							<ModelPicker
								current={shownSelector}
								unset="Default model"
								list={models}
								open={modelsOpen}
								onOpenChange={openModels}
								onPick={next => {
									setModel(next);
									setPickedThinking(null);
								}}
								thinking={{ current: thinking, levels, onPick: pickThinking, allowDefault: true, disabled: modelsRead.error !== null }}
								disabled={starting || !connected}
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
