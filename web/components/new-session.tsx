import { useState } from "react";
import type { BranchChoice, ModelOption, PromptImage } from "../../src/shared";
import { InputMessage } from "@/components/ui/input-message";
import { getJson } from "../api";
import { projectName } from "../labels";
import type { Completions } from "../pane-store";
import { useShortcuts } from "../shortcuts";
import type { StartOf } from "../starts";
import { useGitCheckout } from "../use-git-checkout";
import { useCompletion } from "./completion-popup";
import { blockedShortcut, ComposerNote, EmptyConversation, Header } from "./conversation";
import { BranchPicker, chosenBranch, GitRef, targetOf } from "./git";
import { AttachButton, IMAGE_ACCEPT, useImageAttachments } from "./image-attachments";
import { ModelPicker } from "./model-picker";

interface NewSessionProps {
	/** Where omp starts, as typed or displayed (`~/code/webapp`). */
	cwd: string;
	launch: StartOf<"new"> | null;
	connected: boolean;
	/** The server's last answer to this draft's `complete`. */
	completions: Completions | null;
	/** Ask for `/` and `@` suggestions, resolved as a session started in `cwd` would resolve them. */
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** Start omp with `prompt` and `images` as its first message: in `cwd`, or on `branch` when it names one; on `model`, else on omp's default. */
	onStart: (prompt: string, images: PromptImage[], branch: BranchChoice | null, model: ModelOption | null) => void;
}

/**
 * A session not started yet, with the same composer a live session has. omp starts in `cwd` only when the first message
 * is sent, so leaving the draft leaves nothing running. The message and its images stay in the composer until the session opens.
 * The composer picks the model, and in a git checkout the branch; another branch than `cwd`'s runs in its own worktree.
 */
export function NewSession({ cwd, launch, connected, completions, onComplete, onStart }: NewSessionProps) {
	const [draft, setDraft] = useState("");
	const attachments = useImageAttachments();
	const [picked, setPicked] = useState<{ cwd: string; choice: BranchChoice | null }>({ cwd, choice: null });
	const [model, setModel] = useState<ModelOption | null>(null);
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
			<div className="relative mx-auto w-full max-w-3xl px-6 pb-5">
				{completion.popup}
				<InputMessage
					ref={completion.composerRef}
					value={draft}
					onValueChange={completion.onValueChange}
					onSend={text => {
						if (directCommand) return;
						completion.close();
						attachments.read(images => onStart(text, images, choice, model));
					}}
					placeholder="Message this session…"
					files={attachments.files}
					onFilesChange={attachments.onFilesChange}
					accept={IMAGE_ACCEPT}
					leftSlot={({ openFilePicker }) => (
						<>
							<AttachButton onClick={() => openFilePicker()} disabled={starting} />
							<ModelPicker
								current={model && `${model.provider}/${model.id}`}
								unset="Default model"
								list={models}
								open={modelsOpen}
								onOpenChange={openModels}
								onPick={setModel}
								disabled={starting}
							/>
							{checkout && <BranchPicker checkout={checkout} choice={choice} onChoose={next => setPicked({ cwd, choice: next })} disabled={starting} />}
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
