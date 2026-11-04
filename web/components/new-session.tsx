import { Lock, LockOpen, Sparkles, X } from "lucide-react";
import { type KeyboardEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PullRequestSummary } from "../../src/shared/github";
import { agentOn } from "../../src/shared/moves";
import type { BranchChoice } from "../../src/shared/git";
import type { NewSessionRequest, PastSession, RosterHost } from "../../src/shared/sessions";
import type { Ticket } from "../../src/shared/tickets";
import type { Workspace } from "../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InputMessage } from "@/components/ui/input-message";
import { Tooltip } from "@/components/ui/tooltip";
import { useComposerDraft } from "../composer-drafts";
import { folderName, sameDir, PRIVATE_NOTE } from "../labels";
import type { Completions } from "../pane-store";
import { listedPullRequests, yourMoveCount } from "../pull-requests-model";
import { pullRequestsStore, ticketsStore } from "../reads";
import { usePinnedSkill } from "../pinned-skill";
import { useDraftModelSelection } from "../use-draft-model";
import { useShortcuts } from "../shortcuts";
import type { ScheduleWhen } from "../scheduled-model";
import type { NewOp, StartOf } from "../starts";
import { rankedStarters, type Starter } from "../starters";
import { useGitCheckout } from "../use-git-checkout";
import { useAction } from "../use-action";
import { useSkills } from "../use-skills";
import { useCompletion } from "./completion-popup";
import { useSuggestions } from "./composer-suggestions";
import { blockedShortcut, ComposerEditor, ComposerNote, EmptyConversation } from "./composer";
import { BranchPicker, targetOf } from "./git";
import { ATTACH_ACCEPT, AttachButton, usePromptAttachments } from "./prompt-attachments";
import { DictationButton, DictationRow, useDictation } from "./composer-dictation";
import { PersonalContext, useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { PrivateFacts } from "./new-session-modes";
import type { PromptEditorHandle } from "./prompt-editor";
import { ModelPicker } from "./model-picker";
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
	 * `thinking` when it names a level; through `skill` when it names one.
	 */
	onStart: (op: Omit<NewOp, "kind" | "cwd" | "todoId">) => void;
	/** Start the same session at `when` instead, with no page open; resolves once the server saved it. */
	onSchedule: (op: ScheduledOp, when: ScheduleWhen) => Promise<void>;
	/** The todo the session works on, whose title and notes start the draft; `null` for none. */
	todo: { text: string; prompt: string } | null;
	/** A scheduled start opened to edit: the draft starts as it, sending saves it, **Start now** calls `onStart`, and `onSchedule` moves its time. */
	scheduled?: ScheduledDraft;
	/** Where this browser keeps the unsent text; `null` keeps none. */
	draftKey: string | null;
	/** Where the starters listed under the composer come from; a scheduled start passes none and lists none. */
	starters?: StarterSources;
}

/** What a scheduled start keeps of the draft: text only, in the draft's directory. */
export type ScheduledOp = Omit<NewOp, "kind" | "cwd" | "todoId" | "images">;

export interface ScheduledDraft {
	request: NewSessionRequest;
	/** When it starts, as its sidebar row says it. */
	when: string;
	/** Why its last attempt failed, `null` unless it did. */
	error: string | null;
	/** It is sending, or an edit of it waits on the server. */
	busy: boolean;
	/** Save the draft over it, keeping its time. */
	onSave: (op: ScheduledOp) => Promise<void>;
	/** Cancel it, or dismiss it once it failed. */
	onCancel: () => void;
}

/**
 * A session not started yet, with the same composer a live session has. omp starts in `cwd` only when the first message
 * is sent, so leaving the draft leaves nothing running. The message and its images stay in the composer until the session opens.
 * The composer picks the directory, the model, and in a git checkout the branch; another branch than `cwd`'s runs in its own worktree.
 * A skill pinned in the settings shows as a toggle, on until you turn it off for this session.
 */
export function NewSession({ cwd, workspaces, launch, connected, completions, onComplete, onPickCwd, onStart, onSchedule, todo, scheduled, draftKey, starters }: NewSessionProps) {
	const initial = scheduled?.request ?? null;
	const editorRef = useRef<PromptEditorHandle>(null);
	const [draft, setDraft] = useComposerDraft(draftKey, initial?.prompt ?? todo?.prompt ?? "");
	// Set by a starter's pick until the editor holds it as the draft, so the caret lands after the prompt.
	const prefilled = useRef(false);
	useEffect(() => {
		if (!prefilled.current) return;
		prefilled.current = false;
		editorRef.current?.select(draft.length);
	}, [draft]);
	const attachments = usePromptAttachments(true);
	const [picked, setPicked] = useState<{ cwd: string; choice: BranchChoice | null } | null>(initial && { cwd: initial.cwd, choice: initial.branch });
	const models = useDraftModelSelection(cwd, initial ?? undefined);
	const [pinnedSkill] = usePinnedSkill();
	// A scheduled start keeps the skill it was saved with; with its skill turned off, the toggle offers the pinned one.
	const draftSkill = initial?.skill ?? pinnedSkill;
	const [skipSkill, setSkipSkill] = useState(initial !== null && initial.skill === null);
	const [privateOn, setPrivate] = useState(initial?.private ?? false);
	// A draft that starts from a todo is never private, since nothing may link to a private session.
	const isPrivate = todo === null && privateOn;
	const personal = useContext(PersonalContext);
	const personalDraft = todo === null && sameDir(cwd, personal);
	const skills = useSkills(cwd);
	// The server decides whether the skill applies; the toggle only shows what it will decide.
	const listedSkills = skills.error === null ? skills.data?.skills : [];
	const skillState: SkillState = listedSkills && !listedSkills.some(skill => skill.name === draftSkill) ? "missing" : skipSkill ? "off" : "on";
	// A message that opens with `/` runs its own skill or command and skips the pinned one, so the toggle has nothing to say.
	const ownCommand = draft.trimStart().startsWith("/");
	const [directoriesOpen, setDirectoriesOpen] = useState(false);
	// A failed start can still have added the branch and its worktree, so the picker reads the checkout again.
	const checkout = useGitCheckout(cwd, launch?.phase === "failed" ? launch : null);
	const pickedChoice = picked?.cwd === cwd ? picked.choice : null;
	// A new branch that a failed start created is an existing one now, so the next start uses it as such.
	const choice: BranchChoice | null =
		pickedChoice?.kind === "new" && checkout?.branches.some(branch => branch.name === pickedChoice.name)
			? { kind: "existing", name: pickedChoice.name }
			: pickedChoice;
	const starting = launch?.phase === "starting" || (scheduled?.busy ?? false);
	const privacy = todo ? null : <PrivatePill on={isPrivate} onToggle={() => setPrivate(on => !on)} disabled={starting} />;
	const completion = useCompletion({ editorRef, draft, setDraft, completions, onComplete, composer: { sessionId: null, changed: [] } });
	const { send } = useDashboardActions();
	// A composer that keeps no draft, as a scheduled start's, has nowhere to put text that lands after it closes.
	const dictation = useDictation({ composer: draftKey !== null && !starting ? { draftKey, cwd } : null, text: draft, editorRef, send, connected });
	const onComposerKey = useShortcuts({
		dictate: dictation.toggle,
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
		dictation.onKeyDown(event);
		onComposerKey(event);
		if (!event.defaultPrevented) suggestions.onKeyDown(event);
		if (!event.defaultPrevented && event.key === "Escape") {
			event.currentTarget.blur();
			event.preventDefault();
		}
	};
	const directCommand = blockedShortcut(draft, "new");
	const opOf = (prompt: string): ScheduledOp => ({ prompt, branch: choice, model: models.model, thinking: models.thinking, skill: skipSkill ? null : draftSkill, private: isPrivate });
	const schedule = useAction(async (when: ScheduleWhen) => {
		const prompt = draft.trim();
		await onSchedule(opOf(prompt), when);
		if (!scheduled) setDraft(current => (current.trim() === prompt ? "" : current));
	}, "Could not schedule the session");
	const save = useAction(async (prompt: string) => scheduled?.onSave(opOf(prompt)), "Could not save the scheduled session");
	const target = checkout ? targetOf(checkout, cwd, choice) : { dir: cwd, creates: false };
	const name = folderName(target.dir) ?? target.dir;
	const error = scheduled ? scheduled.error : launch?.phase === "failed" ? launch.error : null;
	const starterList = useStarters(starters, name, choice?.name ?? checkout?.branch ?? null);
	// A private draft lists its facts in the starters' place, and a personal draft lists none, since starters suit project work.
	const panel = scheduled || !isPrivate ? null : <PrivateFacts personal={personalDraft} />;
	const starterLabels = useMemo(() => new Map(starterList.map(starter => [starter.prompt, starter.label])), [starterList]);
	// A starter only fills the draft, since some, such as `/ship `, wait for a blank to be filled.
	const fillStarter = (prompt: string): void => {
		prefilled.current = true;
		setDraft(prompt);
	};
	const suggestions = useSuggestions({
		prompts: connected && !starting && !scheduled && panel === null && !personalDraft ? [...starterLabels.keys()] : NO_PROMPTS,
		labelOf: prompt => starterLabels.get(prompt) ?? prompt,
		draft,
		onSend: fillStarter,
		onFill: fillStarter,
	});
	const pickers = (
		<>
			<DirectoryPicker
				cwd={cwd}
				workspaces={workspaces}
				disabled={starting}
				shortcut="directory"
				open={directoriesOpen}
				onOpenChange={setDirectoriesOpen}
				onPick={onPickCwd}
				control="composer.directory"
			/>
			{checkout && <BranchPicker checkout={checkout} choice={choice} onChoose={next => setPicked({ cwd, choice: next })} disabled={starting} />}
		</>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			{scheduled ? (
				<Header title="Scheduled session" meta={scheduled.when}>
					{privacy}
					<Button variant="ghost" size="compact" disabled={starting || !connected || !draft.trim() || directCommand !== null} onClick={() => onStart({ ...opOf(draft.trim()), images: [] })}>
						{scheduled.error ? "Try again now" : "Start now"}
					</Button>
					<Button variant="ghost" size="compact" disabled={starting || !connected} onClick={scheduled.onCancel}>
						{scheduled.error ? "Dismiss" : "Cancel"}
					</Button>
				</Header>
			) : (
				<Header title="New session" status={starting ? "Starting omp…" : undefined}>
					{privacy}
				</Header>
			)}
			{error !== null && (
				<p role="alert" className="border-b border-border px-6 py-2 text-xs text-red-600 dark:text-red-400">
					{scheduled ? `Not sent: ${error}` : error}
				</p>
			)}
			{scheduled ? (
				<EmptyConversation title={`Scheduled in ${name}`}>
					It starts at its time as Start session would start it. Edit the message, model, skill, directory, or branch, then save; the clock moves its time.
					{todo && ` Your todo “${todo.text}” links to the session once it starts.`}
				</EmptyConversation>
			) : (
				<NewSessionWelcome folder={name} personal={personalDraft} isPrivate={isPrivate} />
			)}
			{/* The composer docks at the page's bottom, a new session's directory and branch above it and its starters inside it. */}
			{/* The pickers above the composer sit inside it too, so a pick hands the focus back to its text box. */}
			<ComposerEditor value={editorRef}>
				<div className="mx-auto w-full max-w-conversation px-3 pb-3">
					{!scheduled && <div className="flex flex-wrap items-center gap-1 pb-1.5">{pickers}</div>}
					<div className="relative">
						{completion.popup}
						<InputMessage
							className={cn(isPrivate && "outline-2 outline-foreground")}
							editorRef={editorRef}
							value={draft}
							onValueChange={completion.onValueChange}
							onSend={text => {
								if (directCommand) return;
								completion.close();
								if (scheduled) save.run(text.trim());
								else void attachments.read(text, async (prompt, images) => onStart({ ...opOf(prompt), images }));
							}}
							placeholder={personalDraft ? "Ask about meals, plans, errands…" : scheduled ? "Message this session…" : "Describe the work; omp starts when you send it"}
							files={attachments.files}
							onFilesChange={attachments.onFilesChange}
							accept={ATTACH_ACCEPT}
							leftSlot={
								<>
									{scheduled && pickers}
									<ModelPicker {...models.picker} disabled={starting || !connected} control="composer.model" />
									{draftSkill !== null && !ownCommand && <SkillToggle name={draftSkill} state={skillState} onToggle={() => setSkipSkill(skip => !skip)} disabled={starting} />}
								</>
							}
							rightSlot={({ openFilePicker }) => (
								<>
									<ScheduleButton draft={draft} files={attachments.files.length} disabled={starting || !connected} pending={schedule.pending} onSchedule={schedule.run} />
									{!scheduled && <AttachButton onClick={() => openFilePicker()} disabled={starting} />}
									<DictationButton dictation={dictation} />
								</>
							)}
							disabled={starting || !connected}
							locked={dictation.locked}
							beforeEditor={<DictationRow dictation={dictation} />}
							sendLabel={scheduled ? "Save" : starting ? "Starting session" : "Start session"}
							sending={starting || save.pending}
							editorProps={{
								...completion.editorProps,
								"aria-activedescendant": completion.editorProps["aria-activedescendant"] ?? suggestions.activeId,
								onKeyDown,
								onBlur: suggestions.onBlur,
								onPaste: scheduled ? undefined : attachments.onPaste,
								autoFocus: true,
							}}
							afterActions={suggestions.list}
						/>
					</div>
					{directCommand && <ComposerNote text={directCommand} />}
					{attachments.note && <ComposerNote text={attachments.note} />}
					{!scheduled && todo && <p className="mt-2 px-1 text-xs text-muted-foreground">Your todo “{todo.text}” links to the session once it starts.</p>}
					{panel}
				</div>
			</ComposerEditor>
		</div>
	);
}

/** Where the starters' blanks and ranking come from beyond the draft: the live sessions, which tell whose move a pull request waits on, and whether Linear answers. */
export interface StarterSources {
	hosts: RosterHost[];
	linear: boolean;
}

const NO_STARTERS: Starter[] = [];
const NO_PROMPTS: string[] = [];
const NO_TICKETS: Ticket[] = [];
const NO_PULL_REQUESTS: PullRequestSummary[] = [];

/** The starters for a draft in `folder` on `branch`, the best fit now first; none without `sources`. */
function useStarters(sources: StarterSources | undefined, folder: string, branch: string | null): Starter[] {
	const { pullRequestsScope } = useDashboardStatus();
	const tickets = ticketsStore.usePolling(null, sources?.linear ?? false).read?.data.tickets ?? NO_TICKETS;
	const list = pullRequestsStore.use(pullRequestsScope).read?.data ?? null;
	const hosts = sources?.hosts;
	return useMemo(() => {
		if (!hosts) return NO_STARTERS;
		const pullRequests = list ? listedPullRequests(list.repos) : NO_PULL_REQUESTS;
		const waiting = list ? yourMoveCount(list, agentOn(hosts)) : 0;
		return rankedStarters({ folder, branch, tickets, pullRequests, waiting, now: new Date() });
	}, [hosts, list, tickets, folder, branch]);
}

/** Whether the pinned skill applies: `missing` when the directory has no such skill. */
type SkillState = "on" | "off" | "missing";

function skillTitle(name: string, state: SkillState): string {
	switch (state) {
		case "on":
			return `The first message goes through /skill:${name}. Click to start without it.`;
		case "off":
			return `Click to send the first message through /skill:${name}.`;
		case "missing":
			return `No skill named ${name} in this directory, so the session starts without it.`;
		default: {
			const unhandled: never = state;
			return unhandled;
		}
	}
}

function SkillToggle({ name, state, onToggle, disabled }: { name: string; state: SkillState; onToggle: () => void; disabled: boolean }) {
	const off = disabled || state === "missing";
	return (
		<Tooltip content={skillTitle(name, state)} disabled={off}>
			<Button
				variant="ghost"
				size="compact"
				leadingIcon={Sparkles}
				aria-pressed={state === "on"}
				aria-label={`Skill ${name}`}
				onClick={onToggle}
				disabled={off}
			>
				<span className={cn("max-w-40 truncate", state !== "on" && "text-muted-foreground line-through")}>{name}</span>
			</Button>
		</Tooltip>
	);
}

/** The header's Private switch: an outlined pill while off, a filled one with a close mark while on. */
function PrivatePill({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled: boolean }) {
	return (
		<Tooltip content={PRIVATE_NOTE} disabled={disabled}>
			<button
				type="button"
				aria-pressed={on}
				onClick={onToggle}
				disabled={disabled}
				className={cn(
					"inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-border ring-inset transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none disabled:opacity-50",
					on ? "bg-foreground text-background ring-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
				)}
			>
				{on ? <Lock aria-hidden className="size-3.5" /> : <LockOpen aria-hidden className="size-3.5" />}
				Private
				{on && <X aria-hidden className="size-3" />}
			</button>
		</Tooltip>
	);
}

/** What a new session's empty page says above the docked composer: the omp mark over a serif question naming where the work happens. */
function NewSessionWelcome({ folder, personal, isPrivate }: { folder: string; personal: boolean; isPrivate: boolean }) {
	return (
		<div className="m-auto flex w-full max-w-conversation flex-col items-center px-6 py-10 text-center" data-empty-conversation>
			{isPrivate ? <Lock aria-hidden="true" className="size-7" /> : <OmpMark className="size-8" />}
			<h2 className="mt-5 max-w-lg font-serif text-[2rem] leading-tight font-normal tracking-tight text-balance">
				{personal ? (
					"What can I help with?"
				) : (
					<>
						What should we work on in <span className="underline decoration-[oklch(0.62_0.21_295)]/40 decoration-2 underline-offset-[6px]">{folder}</span>?
					</>
				)}
			</h2>
			{isPrivate && <p className="mt-3 max-w-sm text-sm text-pretty text-muted-foreground">{PRIVATE_NOTE}</p>}
		</div>
	);
}

/** omp's mark, the gradient glyph of `web/favicon.svg`. */
function OmpMark({ className }: { className?: string }) {
	return (
		<svg viewBox="8 12 48 46" aria-hidden="true" className={className}>
			<defs>
				<linearGradient id="omp-mark" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="oklch(0.7 0.24 340)" />
					<stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
					<stop offset="1" stopColor="oklch(0.81 0.14 200)" />
				</linearGradient>
			</defs>
			<path fill="url(#omp-mark)" d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
		</svg>
	);
}
