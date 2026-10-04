import { Sparkles } from "lucide-react";
import { useState } from "react";
import type { BranchChoice, ModelOption, ModelRole } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InputMessage } from "@/components/ui/input-message";
import { getJson } from "../api";
import { projectName } from "../labels";
import type { Completions } from "../pane-store";
import { usePinnedSkill } from "../pinned-skill";
import { useShortcuts } from "../shortcuts";
import type { NewOp, StartOf } from "../starts";
import { useGitCheckout } from "../use-git-checkout";
import { roleOf, useModelRoles } from "../use-model-roles";
import { useSkills } from "../use-skills";
import { useCompletion } from "./completion-popup";
import { blockedShortcut, ComposerNote, EmptyConversation, Header } from "./conversation";
import { BranchPicker, chosenBranch, GitRef, targetOf } from "./git";
import { AttachButton, IMAGE_ACCEPT, useImageAttachments } from "./image-attachments";
import { ModelPicker } from "./model-picker";
import { RolePicker } from "./role-picker";

interface NewSessionProps {
	/** Where omp starts, as typed or displayed (`~/code/webapp`). */
	cwd: string;
	launch: StartOf<"new"> | null;
	connected: boolean;
	/** The server's last answer to this draft's `complete`. */
	completions: Completions | null;
	/** Ask for `/` and `@` suggestions, resolved as a session started in `cwd` would resolve them. */
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** Start omp with the first message: in `cwd`, or on `branch` when it names one; on `model`, else on omp's default; at `thinking` when it names a level; through `skill` when it names one. */
	onStart: (op: Omit<NewOp, "kind" | "cwd">) => void;
}

/** What the draft starts on: omp's default, a role, or a model picked by itself at omp's thinking level. */
type Selection = { kind: "default" } | { kind: "role"; role: ModelRole } | { kind: "model"; model: ModelOption };

/** The model, thinking level, and role a start sends for `selection`; `null` leaves each to omp. */
function startModel(selection: Selection): Pick<NewOp, "model" | "thinking" | "role"> {
	switch (selection.kind) {
		case "default":
			return { model: null, thinking: null, role: null };
		case "role":
			return { model: selection.role.model, thinking: selection.role.thinking, role: selection.role.role };
		case "model":
			return { model: selection.model, thinking: null, role: null };
		default: {
			const unhandled: never = selection;
			return unhandled;
		}
	}
}

/**
 * A session not started yet, with the same composer a live session has. omp starts in `cwd` only when the first message
 * is sent, so leaving the draft leaves nothing running. The message and its images stay in the composer until the session opens.
 * The composer picks the model role or the model, and in a git checkout the branch; another branch than `cwd`'s runs in its own worktree.
 * A skill pinned in the settings shows as a toggle, on until you turn it off for this session.
 */
export function NewSession({ cwd, launch, connected, completions, onComplete, onStart }: NewSessionProps) {
	const [draft, setDraft] = useState("");
	const attachments = useImageAttachments();
	const [picked, setPicked] = useState<{ cwd: string; choice: BranchChoice | null }>({ cwd, choice: null });
	const [selection, setSelection] = useState<Selection>({ kind: "default" });
	const roles = useModelRoles(cwd);
	// Until a pick, omp starts on its `default` role, so the pickers show that role and its model.
	const defaultRole = roles.list?.roles.find(other => other.role === "default") ?? null;
	const sent = startModel(selection);
	const shownModel = sent.model ?? defaultRole?.model ?? null;
	const role =
		roles.list &&
		(selection.kind === "role"
			? selection.role
			: selection.kind === "model"
				? roleOf(roles.list.roles, `${selection.model.provider}/${selection.model.id}`, null, null)
				: defaultRole);
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
	const [models, setModels] = useState<{ models: ModelOption[]; error: string | null } | null>(null);
	const [modelsOpen, setModelsOpen] = useState(false);
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
	// As in a live session, the list refreshes on every open, so a login since the last one shows.
	const openModels = (open: boolean): void => {
		setModelsOpen(open);
		if (!open) return;
		getJson<{ models: ModelOption[] }>("/api/models/connected").then(
			({ models }) => setModels({ models, error: null }),
			(err: unknown) => setModels({ models: [], error: err instanceof Error ? err.message : String(err) }),
		);
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
						attachments.read(images => onStart({ prompt: text, images, branch: choice, ...sent, skill: skipSkill ? null : pinnedSkill }));
					}}
					placeholder="Message this session…"
					files={attachments.files}
					onFilesChange={attachments.onFilesChange}
					accept={IMAGE_ACCEPT}
					leftSlot={({ openFilePicker }) => (
						<>
							<AttachButton onClick={() => openFilePicker()} disabled={starting} />
							<RolePicker list={roles.list} current={role} onReload={roles.reload} onPick={next => setSelection({ kind: "role", role: next })} disabled={starting} />
							<ModelPicker
								current={shownModel && `${shownModel.provider}/${shownModel.id}`}
								unset="Default model"
								list={models}
								open={modelsOpen}
								onOpenChange={openModels}
								onPick={next => setSelection({ kind: "model", model: next })}
								disabled={starting}
							/>
							{checkout && <BranchPicker checkout={checkout} choice={choice} onChoose={next => setPicked({ cwd, choice: next })} disabled={starting} />}
							{pinnedSkill !== null && <PinnedSkillToggle name={pinnedSkill} state={skillState} onToggle={() => setSkipSkill(skip => !skip)} disabled={starting} />}
						</>
					)}
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
