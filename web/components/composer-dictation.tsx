/**
 * The composer's microphone: its button, the setup popover the first use opens, and the status row above the text field
 * while a capture runs or after it failed. The page's one capture lives in `web/dictation.ts`.
 */
import { Mic } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { errorText } from "../../src/json";
import { blockedByWorkspace, type DictationSettings, processingText } from "../../src/shared/dictation";
import type { ClientMsg } from "../../src/shared/protocol";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { getJson, putJson } from "../api";
import { useComposerReplacements } from "../composer-drafts";
import { capturing, type Dictation, discardDictation, dismissDictation, keepPreview, startDictation, stopDictation, stopDictationFor, useDictationState } from "../dictation";
import { hashForSettings } from "../routing";
import { pressesChord, shortcutBindings, shortcutLabels } from "../shortcuts";
import { useInlineConfirm } from "../use-inline-confirm";
import type { PromptEditorHandle } from "./prompt-editor";

/** Reading the settings before a capture: under way, failed, or showing them because dictation is off or was just turned on. */
type Setup =
	| { phase: "checking" }
	| { phase: "unreadable"; error: string }
	| { phase: "off"; settings: DictationSettings; enabling: boolean; error: string | null }
	| { phase: "enabled"; settings: DictationSettings };

interface DictationOptions {
	/** The draft dictated text lands in; `null` for a composer that keeps none, which offers no dictation. */
	draftKey: string | null;
	/** The directory whose omp settings decide whether dictation is on, and where speech is processed. */
	cwd: string;
	/** The composer's text now. */
	text: string;
	editorRef: RefObject<PromptEditorHandle | null>;
	send: (msg: ClientMsg) => void;
	connected: boolean;
}

/** One composer's view of the page's capture, and what its button, its row, and its shortcut do. */
export interface ComposerDictation {
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

/** The composer's dictation: the capture of `draftKey`, if the page's is, and the text it brings in. */
export function useDictation({ draftKey, cwd, text, editorRef, send, connected }: DictationOptions): ComposerDictation {
	const dictation = useDictationState();
	const own = draftKey !== null && dictation?.target.draftKey === draftKey ? dictation : null;
	const [setup, setSetup] = useState<Setup | null>(null);
	const selection = useRef<{ start: number; end: number } | null>(null);
	const reading = useRef<AbortController | null>(null);
	const latest = useRef({ text, cwd, draftKey });
	latest.current = { text, cwd, draftKey };

	useComposerReplacements(draftKey, ({ start, end, text: dictated }) => {
		editorRef.current?.replace(start, end, dictated);
		// The text field turns editable again on the render this capture's end causes, and only an editable field takes the caret.
		requestAnimationFrame(() => editorRef.current?.focus());
	});

	// Leaving the composer stops its capture and keeps what it heard, as Stop does.
	useEffect(
		() => () => {
			reading.current?.abort();
			if (draftKey !== null) stopDictationFor(draftKey, send);
		},
		[draftKey, send],
	);

	const begin = async (): Promise<void> => {
		const at = selection.current ?? editorRef.current?.selection() ?? { start: latest.current.text.length, end: latest.current.text.length };
		selection.current = null;
		reading.current?.abort();
		const controller = new AbortController();
		reading.current = controller;
		setSetup({ phase: "checking" });
		try {
			const settings = await getJson<DictationSettings>(`/api/dictation/settings?cwd=${encodeURIComponent(latest.current.cwd)}`, controller.signal);
			if (!settings.enabled) return setSetup({ phase: "off", settings, enabling: false, error: null });
			setSetup(null);
			const { draftKey: key, cwd: dir, text: now } = latest.current;
			if (key !== null) startDictation({ draftKey: key, cwd: dir, text: now, ...at }, send);
		} catch (error) {
			if (!controller.signal.aborted) setSetup({ phase: "unreadable", error: errorText(error) });
		}
	};

	const toggle = (): boolean => {
		if (capturing(own)) {
			stopDictation(send);
			return true;
		}
		if (draftKey === null || capturing(dictation) || !connected || setup?.phase === "checking") return false;
		void begin();
		return true;
	};

	const enable = (): void => {
		if (setup?.phase !== "off") return;
		setSetup({ ...setup, enabling: true, error: null });
		putJson<DictationSettings>(`/api/dictation/settings?cwd=${encodeURIComponent(cwd)}`, { enabled: true }).then(
			settings => setSetup(settings.enabled ? { phase: "enabled", settings } : { phase: "off", settings, enabling: false, error: null }),
			(error: unknown) => setSetup({ ...setup, enabling: false, error: errorText(error) }),
		);
	};

	return {
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
			reading.current?.abort();
			setSetup(null);
		},
		stop: () => stopDictation(send),
		discard: () => discardDictation(send),
		onKeyDown: event => {
			const stops = event.key === "Escape" || DICTATE.some(chord => pressesChord(event, chord));
			if (!stops || event.repeat || !capturing(own) || own.phase === "transcribing") return;
			event.preventDefault();
			stopDictation(send);
		},
	};
}

/** The microphone button, in the composer's action bar; the setup popover opens from it. */
export function DictationButton({ dictation }: { dictation: ComposerDictation }) {
	const { own, elsewhere, setup, connected, toggle, keepSelection, enable, closeSetup, onKeyDown } = dictation;
	const active = capturing(own);
	const open = setup?.phase === "off" || setup?.phase === "enabled";
	const tooltip = elsewhere ? "Dictation is active in another composer" : !connected ? "Dictation needs the connection to the server" : active ? "Stop dictating" : "Dictate a prompt";
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
							// Kept focusable while it transcribes, so the focus stays on the button as the capture ends.
							aria-disabled={own?.phase === "transcribing" || undefined}
							disabled={elsewhere || (!connected && !active)}
							loading={setup?.phase === "checking"}
							active={active || open}
							className={active ? "text-foreground" : undefined}
							onPointerDown={keepSelection}
							onKeyDown={onKeyDown}
							onClick={() => own?.phase !== "transcribing" && toggle()}
						>
							<Mic aria-hidden="true" />
						</Button>
					</PopoverAnchor>
				</span>
			</Tooltip>
			<PopoverContent align="end" side="top" className="w-80 space-y-3 p-3">
				{setup?.phase === "off" && <SetupOff setup={setup} onEnable={enable} onClose={closeSetup} />}
				{setup?.phase === "enabled" && (
					<PopoverHeader>
						<PopoverTitle>Dictation is on</PopoverTitle>
						<PopoverDescription>Press the microphone again to start. {describe(setup.settings)}</PopoverDescription>
					</PopoverHeader>
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
			<PopoverHeader>
				<PopoverTitle>{blocked ? "Disabled by this workspace" : "Dictation is off"}</PopoverTitle>
				<PopoverDescription>
					{blocked
						? `${setup.settings.enabledBy === "env" ? "An environment variable" : "This workspace's omp config"} turns dictation off, which your own config cannot change.`
						: `Your microphone's speech becomes text in this composer, which you review before sending. ${describe(setup.settings)}`}
				</PopoverDescription>
			</PopoverHeader>
			{setup.error !== null && (
				<p role="alert" className="text-xs text-destructive-foreground">
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

/** The status row above the text field: the settings read, the capture under way, or how it failed. */
export function DictationRow({ dictation }: { dictation: ComposerDictation }) {
	const { own, setup, toggle, stop, discard, closeSetup, onKeyDown } = dictation;
	const confirm = useInlineConfirm("dictation");
	if (own === null && (setup === null || setup.phase === "off" || setup.phase === "enabled")) return null;
	const discardButton = (
		<Button size="xs" variant="destructive-outline" {...confirm.props("discard", discard)}>
			<span className="inline-grid">
				<span aria-hidden className="invisible col-start-1 row-start-1">
					Confirm discard?
				</span>
				<span className="col-start-1 row-start-1">{confirm.isArmed("discard") ? "Confirm discard?" : "Discard"}</span>
			</span>
		</Button>
	);
	const row = ((): { status: string; detail: string | null; tone: "muted" | "active" | "error"; actions: ReactNode } => {
		if (own === null) {
			return setup?.phase === "unreadable"
				? {
						status: "Could not read dictation settings",
						detail: setup.error,
						tone: "error",
						actions: (
							<>
								<Button size="xs" variant="outline" onClick={toggle}>
									Try again
								</Button>
								<Button size="xs" variant="ghost" onClick={closeSetup}>
									Dismiss
								</Button>
							</>
						),
					}
				: { status: "Checking dictation settings…", detail: null, tone: "muted", actions: null };
		}
		switch (own.phase) {
			case "starting":
				return {
					status: "Preparing dictation…",
					detail: null,
					tone: "muted",
					actions: (
						<Button size="xs" variant="outline" onClick={stop}>
							Cancel
						</Button>
					),
				};
			case "listening":
				return {
					status: own.processing ? `Listening on this computer · transcribed by ${processingText(own.processing)}` : "Listening on this computer",
					detail: own.preview || "Speak now. Text appears here when available.",
					tone: "active",
					actions: (
						<>
							<Button size="xs" variant="outline" onClick={stop}>
								Stop
							</Button>
							{discardButton}
						</>
					),
				};
			case "transcribing":
				return { status: "Transcribing…", detail: own.preview || null, tone: "active", actions: discardButton };
			case "empty":
				return {
					status: "No speech detected. Try again.",
					detail: null,
					tone: "muted",
					actions: (
						<>
							<Button size="xs" variant="outline" onClick={toggle}>
								Try again
							</Button>
							<Button size="xs" variant="ghost" onClick={dismissDictation}>
								Dismiss
							</Button>
						</>
					),
				};
			case "failed":
				return {
					status: own.error,
					detail: own.preview || null,
					tone: "error",
					actions: (
						<>
							{own.preview !== "" && (
								<Button size="xs" variant="outline" onClick={keepPreview}>
									Use preview
								</Button>
							)}
							<Button size="xs" variant="outline" onClick={toggle}>
								Retry
							</Button>
							<Button size="xs" variant="ghost" onClick={dismissDictation}>
								Dismiss
							</Button>
						</>
					),
				};
			default: {
				const unhandled: never = own;
				return unhandled;
			}
		}
	})();
	return (
		<div className="mb-1 flex items-start gap-2 rounded-lg bg-muted px-2.5 py-1 text-[13px]" onKeyDown={onKeyDown}>
			{row.tone === "active" && <span aria-hidden className="mt-2 size-2 shrink-0 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" />}
			<div className="min-w-0 flex-1 py-0.5">
				{/* Only the status is announced: the preview changes with every word. */}
				<p role="status" aria-live="polite" className={row.tone === "error" ? "text-destructive-foreground" : row.tone === "active" ? "text-foreground" : "text-muted-foreground"}>
					{row.status}
				</p>
				{row.detail !== null && <p className="line-clamp-3 text-muted-foreground">{row.detail}</p>}
			</div>
			{row.actions !== null && <div className="flex shrink-0 items-center gap-1.5">{row.actions}</div>}
		</div>
	);
}
