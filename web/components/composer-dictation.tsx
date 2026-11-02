/**
 * The composer's microphone: its button, the setup popover a capture opens where dictation is off, and the status row
 * above the text field while a capture runs or after it failed. The page's one capture lives in `web/dictation.ts`.
 */
import { Mic } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";
import { errorText } from "../../src/json";
import { blockedByWorkspace, DICTATION_BUSY, type DictationSettings, processingText } from "../../src/shared/dictation";
import type { ClientMsg } from "../../src/shared/protocol";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { putJson } from "../api";
import { useComposerReplacements } from "../composer-drafts";
import {
	capturing,
	type Dictation,
	type DictationAction,
	discardDictation,
	dismissDictation,
	keepPreview,
	rowOf,
	startDictation,
	stopDictation,
	stopDictationFor,
	stoppable,
	useDictationState,
} from "../dictation";
import { hashForSettings } from "../routing";
import { pressesChord, shortcutBindings, shortcutLabels } from "../shortcuts";
import { useInlineConfirm } from "../use-inline-confirm";
import type { PromptEditorHandle } from "./prompt-editor";

/** The setup popover: dictation was off, with how turning it on goes, or it was just turned on. */
type Setup = { phase: "off"; settings: DictationSettings; enabling: boolean; error: string | null } | { phase: "enabled"; settings: DictationSettings };

/** How **Enable dictation** went: under way, refused, or answered with the directory's settings after. */
type Enabling = { phase: "enabling" } | { phase: "refused"; error: string } | { phase: "answered"; settings: DictationSettings };

interface DictationOptions {
	/** The draft dictated text lands in and the directory whose omp settings decide dictation; `null` offers no dictation. */
	composer: { draftKey: string; cwd: string } | null;
	/** The composer's text now. */
	text: string;
	editorRef: RefObject<PromptEditorHandle | null>;
	send: (msg: ClientMsg) => void;
	connected: boolean;
}

/** One composer's view of the page's capture, and what its button, its row, and its shortcut do. */
export interface ComposerDictation {
	/** Whether this composer offers dictation at all. */
	available: boolean;
	/** The page's capture, when it belongs to this composer's draft. */
	own: Dictation | null;
	/** Whether a capture of another draft holds the microphone. */
	elsewhere: boolean;
	/** Whether this composer's draft waits on its capture: its text field is read-only and nothing sends. */
	locked: boolean;
	setup: Setup | null;
	connected: boolean;
	/** Starts a capture at the selection, or stops this composer's: the button's click and the `dictate` shortcut. */
	toggle: () => boolean;
	/** Remembers the selection before the button takes focus from the text field. */
	keepSelection: () => void;
	enable: () => void;
	closeSetup: () => void;
	stop: () => void;
	discard: () => void;
	/** Stops this composer's capture on Escape or the `dictate` keys, from its text field, its button, or its row. */
	onKeyDown: (event: KeyboardEvent) => void;
}

const DICTATE = shortcutBindings("dictate").flatMap(binding => ("chord" in binding ? [binding.chord] : []));

/** The composer's dictation: the page's capture, when it is this composer's, and the text it brings in. */
export function useDictation({ composer, text, editorRef, send, connected }: DictationOptions): ComposerDictation {
	const dictation = useDictationState();
	const draftKey = composer?.draftKey ?? null;
	const own = draftKey !== null && dictation?.target.draftKey === draftKey ? dictation : null;
	const [enabling, setEnabling] = useState<Enabling | null>(null);
	const selection = useRef<{ start: number; end: number } | null>(null);

	useComposerReplacements(draftKey, ({ start, end, text: dictated }) => {
		editorRef.current?.replace(start, end, dictated);
		// The text field turns editable again on the render this capture's end causes, and only an editable field takes the caret.
		requestAnimationFrame(() => editorRef.current?.focus());
	});

	// Leaving the composer stops its capture and keeps what it heard, as Stop does.
	useEffect(
		() => () => {
			if (draftKey !== null) stopDictationFor(draftKey, send);
		},
		[draftKey, send],
	);

	const answered = enabling?.phase === "answered" ? enabling.settings : null;
	const setup: Setup | null = answered?.enabled
		? { phase: "enabled", settings: answered }
		: own?.phase === "off"
			? { phase: "off", settings: answered ?? own.settings, enabling: enabling?.phase === "enabling", error: enabling?.phase === "refused" ? enabling.error : null }
			: null;

	const toggle = (): boolean => {
		if (capturing(own)) {
			stopDictation(send);
			return true;
		}
		if (composer === null || capturing(dictation) || !connected) return false;
		const at = selection.current ?? editorRef.current?.selection() ?? { start: text.length, end: text.length };
		selection.current = null;
		setEnabling(null);
		startDictation({ ...composer, text, ...at }, send);
		return true;
	};

	const enable = (): void => {
		if (own?.phase !== "off") return;
		setEnabling({ phase: "enabling" });
		putJson<DictationSettings>(`/api/dictation/settings?cwd=${encodeURIComponent(own.target.cwd)}`, { enabled: true }).then(
			settings => {
				setEnabling({ phase: "answered", settings });
				if (settings.enabled) dismissDictation();
			},
			(error: unknown) => setEnabling({ phase: "refused", error: errorText(error) }),
		);
	};

	return {
		available: composer !== null,
		own,
		elsewhere: capturing(dictation) && own === null,
		locked: capturing(own),
		setup,
		connected,
		toggle,
		keepSelection: () => {
			selection.current = editorRef.current?.selection() ?? null;
		},
		enable,
		closeSetup: () => {
			setEnabling(null);
			if (own?.phase === "off") dismissDictation();
		},
		stop: () => stopDictation(send),
		discard: () => discardDictation(send),
		onKeyDown: event => {
			const stops = event.key === "Escape" || DICTATE.some(chord => pressesChord(event, chord));
			if (!stops || event.repeat || !stoppable(own)) return;
			event.preventDefault();
			stopDictation(send);
		},
	};
}

/** The microphone button, in the composer's action bar; the setup popover opens from it. Nothing for a composer without dictation. */
export function DictationButton({ dictation }: { dictation: ComposerDictation }) {
	const { available, own, elsewhere, setup, connected, toggle, keepSelection, enable, closeSetup, onKeyDown } = dictation;
	if (!available) return null;
	const active = capturing(own);
	const open = setup !== null;
	const tooltip = elsewhere ? DICTATION_BUSY : !connected ? "Dictation needs the connection to the server" : active ? "Stop dictating" : "Dictate a prompt";
	return (
		<Popover open={open} onOpenChange={next => !next && closeSetup()}>
			<Tooltip content={tooltip} shortcut={elsewhere || !connected ? undefined : shortcutLabels("dictate")} side="top" forceOpen={open ? false : undefined}>
				{/* A disabled button takes no pointer events, so the tooltip that says why sits on a wrapper. */}
				<span className="inline-flex">
					<PopoverAnchor asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Dictate a prompt"
							aria-pressed={active}
							// The popover opens once a capture finds dictation off, so it hangs from an anchor and its state is set here.
							aria-haspopup="dialog"
							aria-expanded={open}
							// Kept focusable while it transcribes, so the focus stays on the button as the capture ends.
							aria-disabled={own?.phase === "transcribing" || undefined}
							disabled={elsewhere || (!connected && !active)}
							active={active || open}
							className={active ? "text-foreground" : undefined}
							onPointerDown={keepSelection}
							onKeyDown={onKeyDown}
							onClick={toggle}
						>
							<Mic aria-hidden="true" />
						</Button>
					</PopoverAnchor>
				</span>
			</Tooltip>
			<PopoverContent align="end" side="top" className="w-80 space-y-3 p-3">
				{setup?.phase === "off" && <SetupOff setup={setup} onEnable={enable} onClose={closeSetup} />}
				{setup?.phase === "enabled" && (
					<div className="space-y-1">
						<p className="text-sm font-medium">Dictation is on</p>
						<p className="text-xs text-muted-foreground">Press the microphone again to start. {describe(setup.settings)}</p>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** Where speech goes and in what language, and the download a model on this computer may need first. */
function describe({ language, processing }: DictationSettings): string {
	const download = processing.kind === "local" ? ` The model may first download ${processing.size}.` : "";
	return `Speech in ${languageName(language)} is transcribed by ${processingText(processing)}.${download}`;
}

const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });

/** English's name for a language code, or the code itself when it is not a well-formed one, such as `auto`, which `of` throws on. */
function languageName(code: string): string {
	try {
		return LANGUAGES.of(code) ?? code;
	} catch {
		return code;
	}
}

function SetupOff({ setup, onEnable, onClose }: { setup: Extract<Setup, { phase: "off" }>; onEnable: () => void; onClose: () => void }) {
	const blocked = blockedByWorkspace(setup.settings);
	return (
		<>
			<div className="space-y-1">
				<p className="text-sm font-medium">{blocked ? "Disabled by this workspace" : "Dictation is off"}</p>
				<p className="text-xs text-muted-foreground">
					{blocked
						? `${setup.settings.enabledBy === "env" ? "An environment variable" : "This workspace's omp config"} turns dictation off, which your own config cannot change.`
						: `Your microphone's speech becomes text in this composer, which you review before sending. ${describe(setup.settings)}`}
				</p>
			</div>
			{setup.error !== null && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Could not turn dictation on: {setup.error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button asChild variant="ghost" size="compact">
					<a href={hashForSettings("files")} onClick={onClose}>
						Open config
					</a>
				</Button>
				{!blocked && (
					<Button size="compact" loading={setup.enabling} onClick={onEnable}>
						Enable dictation
					</Button>
				)}
			</div>
		</>
	);
}

const TONES = { muted: "text-muted-foreground", active: "text-foreground", error: "text-red-600 dark:text-red-400" };

/** The status row above the text field while this composer's capture runs, or after it heard nothing or failed. */
export function DictationRow({ dictation }: { dictation: ComposerDictation }) {
	const { own, toggle, stop, discard, onKeyDown } = dictation;
	const confirm = useInlineConfirm("dictation");
	const row = own === null ? null : rowOf(own);
	if (row === null) return null;
	const button = (action: DictationAction) => {
		switch (action) {
			case "cancel":
			case "stop":
				return (
					<Button key={action} size="xs" variant="outline" onClick={stop}>
						{action === "cancel" ? "Cancel" : "Stop"}
					</Button>
				);
			case "discard":
				return (
					<Button key={action} size="xs" variant="destructive-outline" {...confirm.props("discard", discard)}>
						<span className="inline-grid">
							<span aria-hidden className="invisible col-start-1 row-start-1">
								Confirm discard?
							</span>
							<span className="col-start-1 row-start-1">{confirm.isArmed("discard") ? "Confirm discard?" : "Discard"}</span>
						</span>
					</Button>
				);
			case "keep":
				return (
					<Button key={action} size="xs" variant="outline" onClick={keepPreview}>
						Use preview
					</Button>
				);
			case "retry":
				return (
					<Button key={action} size="xs" variant="outline" onClick={toggle}>
						Try again
					</Button>
				);
			case "dismiss":
				return (
					<Button key={action} size="xs" variant="ghost" onClick={dismissDictation}>
						Dismiss
					</Button>
				);
			default: {
				const unhandled: never = action;
				return unhandled;
			}
		}
	};
	return (
		// `data-im-queue` keeps the composer from taking a click here, so the error and the preview stay selectable.
		<div data-im-queue className="mb-1 flex items-start gap-2 rounded-lg bg-muted px-2.5 py-1 text-[13px]" onKeyDown={onKeyDown}>
			{row.tone === "active" && <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-foreground motion-safe:animate-pulse" />}
			<div className="min-w-0 flex-1 py-0.5">
				{/* Only the status is announced: the preview changes with every word. */}
				<p role="status" aria-live="polite" className={TONES[row.tone]}>
					{row.status}
				</p>
				{row.detail !== null && <p className="line-clamp-3 text-muted-foreground">{row.detail}</p>}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">{row.actions.map(button)}</div>
		</div>
	);
}
