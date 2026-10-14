import { Sparkles } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import type { BranchChoice, GitCheckout } from "../../src/shared/git";
import { presetBranch, type SessionPreset } from "../../src/shared/presets";
import type { Workspace } from "../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InputMessage } from "@/components/ui/input-message";
import { Tooltip } from "@/components/ui/tooltip";
import { folderName } from "../labels";
import { getJson } from "../api";
import type { Completions } from "../pane-store";
import { usePinnedSkill } from "../pinned-skill";
import { useDraftModelSelection } from "../use-draft-model";
import { useShortcuts } from "../shortcuts";
import type { ScheduleWhen } from "../scheduled-model";
import type { NewOp, StartOf } from "../starts";
import { useGitCheckout } from "../use-git-checkout";
import { useAction } from "../use-action";
import { useSkills } from "../use-skills";
import { useCompletion } from "./completion-popup";
import { blockedShortcut, ComposerEditor, ComposerNote, ComposerTray, EmptyConversation, OVER_TRAY } from "./composer";
import { BranchPicker, targetOf } from "./git";
import { ATTACH_ACCEPT, AttachButton, usePromptAttachments } from "./prompt-attachments";
import type { PromptEditorHandle } from "./prompt-editor";
import { ModelPicker } from "./model-picker";
import { PresetPicker } from "./preset-picker";
import { Header } from "./page-header";
import { ScheduleButton } from "./scheduled";
import { DirectoryPicker } from "./workspace-picker";

interface NewSessionProps {
	/** Where omp starts, as typed or displayed (`~/code/webapp`). */
	cwd: string;
	/** The workspaces, as {@link listWorkspaces} lists them, which the directory picker offers. */
	workspaces: Workspace[];
	launch: StartOf<"new"> | null;
	connected: boolean;
	/** The server's last answer to this draft's `complete`. */
	completions: Completions | null;
	/** Ask for `/` and `@` suggestions, resolved as a session started in `cwd` would resolve them. */
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** Move the draft to directory `cwd`, as typed or displayed. */
	onPickCwd: (cwd: string) => void;
	/**
	 * Start omp with the first message: in `cwd`, or on `branch` when it names one; on `model`, else on omp's default; at
	 * `thinking` when it names a level; through `skill` when it names one; with `tools` alone when it names some.
	 */
	onStart: (op: Omit<NewOp, "kind" | "cwd" | "todoId">) => void;
	/** Start the same session at `when` instead, with no page open; resolves once the server saved it. */
	onSchedule: (op: Omit<NewOp, "kind" | "cwd" | "todoId" | "images">, when: ScheduleWhen) => Promise<void>;
	/** The todo the session works on, whose title and notes start the draft; `null` for none. */
	todo: { text: string; prompt: string } | null;
	/** The saved presets, which the draft's preset picker offers. */
	presets: SessionPreset[];
}

/**
 * A session not started yet, with the same composer a live session has. omp starts in `cwd` only when the first message
 * is sent, so leaving the draft leaves nothing running. The message and its images stay in the composer until the session opens.
 * The composer picks the directory, the model, and in a git checkout the branch; another branch than `cwd`'s runs in its own worktree.
 * A skill pinned in the settings shows as a toggle, on until you turn it off for this session.
 * A preset fills the model, the thinking level, the skill, and the branch, which stay yours to change, and limits the tools.
 */
export function NewSession({ cwd, workspaces, launch, connected, completions, onComplete, onPickCwd, onStart, onSchedule, todo, presets }: NewSessionProps) {
	const editorRef = useRef<PromptEditorHandle>(null);
	const [draft, setDraft] = useState(todo?.prompt ?? "");
	const attachments = usePromptAttachments(true);
	const [picked, setPicked] = useState<{ cwd: string; choice: BranchChoice | null } | null>(null);
	const models = useDraftModelSelection(cwd);
	const [pinnedSkill] = usePinnedSkill();
	const [selection, setSelection] = useState<{ preset: SessionPreset; at: Date } | null>(null);
	const preset = selection?.preset ?? null;
	const draftSkill = preset ? preset.skill : pinnedSkill;
	const tools = preset?.tools ?? null;
	const [skipSkill, setSkipSkill] = useState(false);
	const skills = useSkills(cwd);
	// The server decides whether the skill applies; the toggle only shows what it will decide.
	const listedSkills = skills.error === null ? skills.data?.skills : [];
	const skillState: SkillState =
		listedSkills && !listedSkills.some(skill => skill.name === draftSkill)
			? "missing"
			: skipSkill
				? "off"
				: draft.trimStart().startsWith("/")
					? "bypassed"
					: "on";
	const [directoriesOpen, setDirectoriesOpen] = useState(false);
	// A failed start can still have added the branch and its worktree, so the picker reads the checkout again.
	const checkout = useGitCheckout(cwd, launch?.phase === "failed" ? launch : null);
	const presetChoice = (current: GitCheckout | null): BranchChoice | null => selection && current ? presetBranch(selection.preset, current.branch, selection.at) : null;
	const pickedChoice = picked?.cwd === cwd ? picked.choice : presetChoice(checkout);
	// A new branch that a failed start created is an existing one now, so the next start uses it as such.
	const choice: BranchChoice | null =
		pickedChoice?.kind === "new" && checkout?.branches.some(branch => branch.name === pickedChoice.name)
			? { kind: "existing", name: pickedChoice.name }
			: pickedChoice;
	const starting = launch?.phase === "starting";
	const completion = useCompletion({ editorRef, draft, setDraft, completions, onComplete, composer: { sessionId: null, changed: [] } });
	const onComposerKey = useShortcuts({
		model: () => {
			if (starting || !connected) return false;
			models.openModels("models");
		},
		directory: () => {
			if (starting) return false;
			setDirectoriesOpen(open => !open);
		},
		thinking: () => {
			if (starting || !connected || !models.levels?.length) return false;
			models.pickThinking(models.levels[(models.levels.indexOf(models.thinking ?? "") + 1) % models.levels.length]);
		},
		focusComposer: () => {
			const editor = editorRef.current;
			if (!editor?.editable()) return false;
			editor.focus();
		},
	});
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (completion.onMenuKeyDown(event)) return;
		onComposerKey(event);
		if (!event.defaultPrevented && event.key === "Escape") {
			event.currentTarget.blur();
			event.preventDefault();
		}
	};
	const directCommand = blockedShortcut(draft, "new");
	const branchForStart = async (): Promise<BranchChoice | null> => {
		if (picked?.cwd === cwd || !selection || selection.preset.worktree === "here") return choice;
		const current = checkout ?? await getJson<GitCheckout | null>(`/api/git?cwd=${encodeURIComponent(cwd)}`);
		if (!current?.branch) throw new Error(`${selection.preset.name} needs a checked-out Git branch.`);
		return checkout ? choice : presetChoice(current);
	};
	const schedule = useAction(async (when: ScheduleWhen) => {
		const prompt = draft.trim();
		await onSchedule({ prompt, branch: await branchForStart(), model: models.model, thinking: models.thinking, skill: skipSkill ? null : draftSkill, tools }, when);
		setDraft(current => (current.trim() === prompt ? "" : current));
	}, "Could not schedule the session");
	const pickPreset = (next: SessionPreset | null): void => {
		setSelection(next ? { preset: next, at: new Date() } : null);
		setSkipSkill(false);
		models.choose(next?.model ?? null, next?.thinking ?? null);
		setPicked(null);
	};
	const target = checkout ? targetOf(checkout, cwd, choice) : { dir: cwd, creates: false };
	const name = folderName(target.dir) ?? target.dir;
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title="New session" status={starting ? "Starting omp…" : undefined} />
			{launch?.phase === "failed" && (
				<p role="alert" className="border-b border-border px-6 py-2 text-xs text-red-600 dark:text-red-400">
					{launch.error}
				</p>
			)}
			<EmptyConversation title={`Start omp in ${name}`}>
				{target.creates
					? "It starts when you send the first message, which adds the worktree, so leaving this draft leaves nothing running."
					: "It starts when you send the first message, so leaving this draft leaves nothing running."}
				{todo && ` Your todo “${todo.text}” links to the session once it starts.`}
			</EmptyConversation>
			<div className="relative mx-auto w-full max-w-3xl px-3 pb-3">
				{completion.popup}
				<ComposerEditor value={editorRef}>
					<InputMessage
						editorRef={editorRef}
						value={draft}
						onValueChange={completion.onValueChange}
						onSend={text => {
							if (directCommand) return;
							completion.close();
							void attachments.read(text, async (prompt, images) => onStart({ prompt, images, branch: await branchForStart(), model: models.model, thinking: models.thinking, skill: skipSkill ? null : draftSkill, tools }));
						}}
						placeholder="Message this session…"
						files={attachments.files}
						onFilesChange={attachments.onFilesChange}
						accept={ATTACH_ACCEPT}
						leftSlot={
							<>
								{(presets.length > 0 || preset !== null) && <PresetPicker presets={presets} value={preset} onPick={pickPreset} disabled={starting} side="top" />}
								<ModelPicker {...models.picker} disabled={starting || !connected} />
								{draftSkill !== null && <SkillToggle name={draftSkill} state={skillState} onToggle={() => setSkipSkill(skip => !skip)} disabled={starting} />}
							</>
						}
						rightSlot={({ openFilePicker }) => (
							<>
								<ScheduleButton draft={draft} files={attachments.files.length} disabled={starting || !connected} pending={schedule.pending} onSchedule={schedule.run} />
								<AttachButton onClick={() => openFilePicker()} disabled={starting} />
							</>
						)}
						disabled={starting || !connected}
						className={OVER_TRAY}
						sendLabel={starting ? "Starting session" : "Start session"}
						sending={starting}
						editorProps={{ ...completion.editorProps, onKeyDown, autoFocus: true }}
					/>
					<ComposerTray
						start={
							<>
								<DirectoryPicker
									cwd={cwd}
									workspaces={workspaces}
									disabled={starting}
									shortcut="directory"
									open={directoriesOpen}
									onOpenChange={setDirectoriesOpen}
									onPick={onPickCwd}
								/>
								{checkout && <BranchPicker checkout={checkout} choice={choice} onChoose={next => setPicked({ cwd, choice: next })} disabled={starting} />}
							</>
						}
					/>
				</ComposerEditor>
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

function SkillToggle({ name, state, onToggle, disabled }: { name: string; state: SkillState; onToggle: () => void; disabled: boolean }) {
	return (
		<Tooltip content={skillTitle(name, state)}>
			<Button
				variant="ghost"
				size="compact"
				leadingIcon={Sparkles}
				aria-pressed={state === "on"}
				aria-label={`Skill ${name}`}
				onClick={onToggle}
				disabled={disabled || state === "missing" || state === "bypassed"}
			>
				<span className={cn("max-w-40 truncate", state !== "on" && "text-muted-foreground line-through")}>{name}</span>
			</Button>
		</Tooltip>
	);
}
