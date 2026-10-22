import { type KeyboardEvent, useRef, useState } from "react";
import type { ComparisonSpec } from "../../src/shared/comparisons";
import type { Workspace } from "../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { useComposerDraft, variantsDraftKey } from "../composer-drafts";
import { folderName } from "../labels";
import type { Completions } from "../pane-store";
import { hashForComparisons, hashForNewSession } from "../routing";
import { useShortcuts } from "../shortcuts";
import { useComparisonStart } from "../use-comparison-start";
import { useDraftModelSelection } from "../use-draft-model";
import { useGitCheckout } from "../use-git-checkout";
import { useCompletion } from "./completion-popup";
import { blockedShortcut, ComposerEditor, ComposerNote, ComposerTray, EmptyConversation, OVER_TRAY } from "./composer";
import { SkillToggle, useDraftSkill } from "./draft-skill";
import { ModelPicker } from "./model-picker";
import { Header } from "./page-header";
import { ATTACH_ACCEPT, AttachButton, usePromptAttachments } from "./prompt-attachments";
import type { PromptEditorHandle } from "./prompt-editor";
import { VariantModelRows, type VariantDraft } from "./variant-model-rows";
import { DirectoryPicker } from "./workspace-picker";

interface NewVariantsProps {
	cwd: string;
	workspaces: Workspace[];
	connected: boolean;
	completions: Completions | null;
	onComplete: (reqId: number, text: string, cursor: number) => void;
	onPickCwd: (cwd: string) => void;
	onStart: (id: string, spec: ComparisonSpec) => Promise<void>;
}

export function NewVariants({ cwd, workspaces, connected, completions, onComplete, onPickCwd, onStart }: NewVariantsProps) {
	const editorRef = useRef<PromptEditorHandle>(null);
	const [draft, setDraft] = useComposerDraft(variantsDraftKey, "");
	const attachments = usePromptAttachments(true);
	const models = useDraftModelSelection(cwd);
	const skill = useDraftSkill(cwd, draft);
	const comparisonStart = useComparisonStart(onStart);
	const [variants, setVariants] = useState<VariantDraft[]>(() => Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), model: null, thinking: null })));
	const [base, setBase] = useState("HEAD");
	const [directoriesOpen, setDirectoriesOpen] = useState(false);
	const checkout = useGitCheckout(cwd, comparisonStart.launch);
	const starting = comparisonStart.launch.kind === "pending";
	const locked = starting || comparisonStart.launch.kind === "uncertain";
	const completion = useCompletion({ editorRef, draft, setDraft, completions, onComplete, composer: { sessionId: null, changed: [] } });
	const onComposerKey = useShortcuts({
		model: () => {
			if (locked || !connected) return false;
			models.openModels("models");
		},
		directory: () => {
			if (locked) return false;
			setDirectoriesOpen(open => !open);
		},
		thinking: () => {
			if (locked || !connected || !models.levels?.length) return false;
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
	const launch = comparisonStart.launch;
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
			<Header title="New design comparison" status={starting ? "Starting variants…" : undefined}>
				<a href={hashForNewSession(cwd)} className="text-xs underline underline-offset-4">Single session</a>
				<a href={hashForComparisons()} className="text-xs underline underline-offset-4">Comparisons</a>
			</Header>
			{(launch.kind === "uncertain" || launch.kind === "failed") && (
				<div role="alert" className="space-y-2 px-6 py-3 text-xs">
					<p>{launch.error}</p>
					{launch.kind === "uncertain" && (
						<p>
							The start may have taken effect. <a className="underline" href={hashForComparisons(launch.id)}>Check this comparison</a> before starting another.
						</p>
					)}
					<Button variant="ghost" size="compact" onClick={comparisonStart.reset}>Start a separate comparison</Button>
				</div>
			)}
			<EmptyConversation title={`Compare ${variants.length} designs in ${folderName(cwd) ?? cwd}`}>
				One prompt starts independent sessions from the same captured Git commit. Compare their published screenshots, then keep a design.
			</EmptyConversation>
			<div className="relative mx-auto w-full max-w-3xl px-3 pb-3">
				<label className="mb-4 flex flex-wrap items-center gap-2 text-xs">
					Shared base
					<input
						value={base}
						onChange={event => setBase(event.target.value)}
						disabled={locked}
						list="variant-bases"
						className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-base sm:text-sm"
					/>
				</label>
				<datalist id="variant-bases">
					<option value="HEAD" />
					{checkout?.branches.map(branch => <option key={branch.name} value={branch.name} />)}
				</datalist>
				<VariantModelRows rows={variants} common={models} disabled={locked} onChange={setVariants} />
				{completion.popup}
				<ComposerEditor value={editorRef}>
					<InputMessage
						editorRef={editorRef}
						value={draft}
						onValueChange={completion.onValueChange}
						onSend={text => {
							if (directCommand) return;
							completion.close();
							void attachments.read(text, (prompt, images) => comparisonStart.start({
								cwd, prompt, images, base: base.trim() || "HEAD", model: models.model, thinking: models.thinking,
								skill: skill.skill,
								variants: variants.map(({ model, thinking }) => ({ model, thinking })),
							}));
						}}
						placeholder="Describe the designs to compare…"
						files={attachments.files}
						onFilesChange={attachments.onFilesChange}
						accept={ATTACH_ACCEPT}
						leftSlot={
							<>
								<ModelPicker {...models.picker} disabled={locked || !connected} />
								{skill.name !== null && <SkillToggle name={skill.name} state={skill.state} onToggle={skill.toggle} disabled={locked} />}
							</>
						}
						rightSlot={({ openFilePicker }) => <AttachButton onClick={() => openFilePicker()} disabled={locked} />}
						disabled={locked || !connected}
						className={OVER_TRAY}
						sendLabel={`Start ${variants.length} variants`}
						sending={starting}
						editorProps={{ ...completion.editorProps, onKeyDown, autoFocus: true }}
					/>
					<ComposerTray
						start={
							<DirectoryPicker
								cwd={cwd}
								workspaces={workspaces}
								disabled={locked}
								shortcut="directory"
								open={directoriesOpen}
								onOpenChange={setDirectoriesOpen}
								onPick={onPickCwd}
							/>
						}
					/>
				</ComposerEditor>
				{directCommand && <ComposerNote text={directCommand} />}
				{attachments.note && <ComposerNote text={attachments.note} />}
			</div>
		</div>
	);
}
