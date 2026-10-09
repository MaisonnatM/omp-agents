"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { spring } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/size-context";
import { useIcon } from "@/lib/icon-context";
import { surfaceClasses } from "@/lib/surface-classes";
import { SurfaceProvider } from "@/lib/surface-context";
import { useRegionHeight } from "@/hooks/use-region-height";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { FilePreviewTile } from "@/components/ui/file-preview-tile";
import { PromptEditor, type PromptEditorHandle } from "@/components/prompt-editor";

const DEFAULT_ACCEPT = "image/png,image/jpeg,application/pdf";

interface InputMessageSlotContext {
  /** Opens the native file picker via the hidden `<input type="file">`.
   *  Pass `acceptOverride` (e.g. `"image/*"`) to scope the picker to a
   *  subset of the component's accept types just for this invocation. */
  openFilePicker: (acceptOverride?: string) => void;
  /** Currently-attached files (controlled). */
  files: File[];
}

type InputMessageSlot =
  | ReactNode
  | ((ctx: InputMessageSlotContext) => ReactNode);

interface InputMessageProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Step on the size ladder. Wins over the surrounding SizeProvider and
   *  propagates to the composer's rows and buttons. */
  size?: SizeVariant;
  /** Controlled draft. */
  value: string;
  /** Called with the new value on every edit the user makes. */
  onValueChange: (value: string) => void;
  /** Fired when the user submits (Enter or the send button). Receives the
   *  trimmed value and the attached files. */
  onSend?: (value: string, files: File[]) => void;
  /** Placeholder text shown when the value is empty. */
  placeholder?: string;
  /** Content rendered in the bottom-left action area. Can be a function that
   *  receives `{ openFilePicker, files }` to wire an attach button. */
  leftSlot?: InputMessageSlot;
  /** Content rendered in the bottom-right action area, before the built-in
   *  send button. Same render-fn shape as leftSlot. */
  rightSlot?: InputMessageSlot;
  /** Disables the text field, send button, drag-and-drop, and pasting files. */
  disabled?: boolean;
  /** Minimum visible rows before the text field grows. */
  minRows?: number;
  /** Maximum visible rows before the text field starts to scroll. */
  maxRows?: number;
  /** Accessible label for the send button. */
  sendLabel?: string;
  /** Shows the send button's spinner while the consumer's send runs. */
  sending?: boolean;
  /** Controlled list of attached files. When undefined, attachment behavior
   *  is disabled (no drag-drop, no paste, no file input). */
  files?: File[];
  /** Called when files are added (drag-drop, paste, or picker) or removed. */
  onFilesChange?: (files: File[]) => void;
  /** Accepted MIME types as a comma-separated string. Defaults to PNG / JPEG / PDF. */
  accept?: string;
  /** Extra props forwarded to the text field's contenteditable element. Its
   *  `onKeyDown` and `onPaste` run before the editor's own handling. */
  editorProps?: Omit<
    HTMLAttributes<HTMLDivElement>,
    "onChange" | "onKeyDownCapture" | "onPasteCapture" | "placeholder"
  >;
  /** The text field's caret and focus, for a consumer that moves either. */
  editorRef?: Ref<PromptEditorHandle>;
  /** Assistant response state. When `"streaming"`, the send button becomes a
   *  Stop control while the draft is empty. */
  status?: "idle" | "streaming";
  /** Fired when the Stop control is pressed (streaming, empty draft). */
  onStop?: () => void;
  /** Shows the Stop button's spinner while the consumer's stop runs. */
  stopping?: boolean;
  /** Keys that press Stop, shown in its tooltip; no tooltip when omitted. */
  stopShortcut?: readonly string[];
  /** Rendered above the text field, below the attached files. */
  beforeEditor?: ReactNode;
  /** Rendered under the action bar, inside the composer's frame. */
  afterActions?: ReactNode;
}

// ─── InputMessage ─────────────────────────────────────────────────────────

const InputMessage = memo(forwardRef<HTMLDivElement, InputMessageProps>(
  (
    {
      size,
      value,
      onValueChange,
      onSend,
      placeholder = "Ask me anything…",
      leftSlot,
      rightSlot,
      disabled,
      minRows = 1,
      maxRows = 8,
      sendLabel = "Send",
      sending = false,
      files,
      onFilesChange,
      accept = DEFAULT_ACCEPT,
      editorProps,
      editorRef,
      status,
      onStop,
      stopping = false,
      stopShortcut,
      beforeEditor,
      afterActions,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const shape = useShape();
    const compactStep = useSize(size).variant === "compact";
    const ArrowUpIcon = useIcon("arrow-up");
    const reduceMotion = useReducedMotion() ?? false;

    const editorHandle = useRef<PromptEditorHandle | null>(null);
    const setEditorHandle = useCallback(
      (handle: PromptEditorHandle | null) => {
        editorHandle.current = handle;
        if (typeof editorRef === "function") editorRef(handle);
        else if (editorRef) editorRef.current = handle;
      },
      [editorRef]
    );
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [focusVisible, setFocusVisible] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [hovered, setHovered] = useState(false);

    // Split out the handlers composed below, so the rest-spread onto the
    // editor can't clobber them.
    const {
      onFocus: _editorOnFocus,
      onBlur: _editorOnBlur,
      onKeyDown: _editorOnKeyDown,
      onPaste: editorOnPaste,
      "aria-label": editorLabel,
      ...restEditorProps
    } = editorProps ?? {};

    const filesArr = useMemo(() => files ?? [], [files]);
    const supportsFiles = onFilesChange !== undefined;
    const streaming = status === "streaming";

    // Pixel height for the attachments' collapsible region (see useRegionHeight).
    const [filesRegionRef, filesRegionHeight] = useRegionHeight();
    const trimmed = value.trim();
    const canSend = !disabled && (trimmed.length > 0 || filesArr.length > 0);

    // Edge = the box-shadow's 1px ring, recoloured in place per state so the
    // stroke gains contrast without ever appearing to thicken (no second
    // border band layered beside it). The drop (`0 1px 1px`) is kept so the
    // composer holds its lift across states. Applied inline (not via a Tailwind
    // `shadow-*` utility, which mangles multi-layer arbitrary values) with the
    // precedence drag > focus > hover; when none are active, the className's
    // `shadow-surface-2` supplies the resting edge.
    const EDGE_DROP = "0 1px 1px -0.5px var(--shadow-color)";
    const edgeShadow = dragOver
      ? `0 0 0 1px #6B97FF, ${EDGE_DROP}`
      : focusVisible
        ? `0 0 0 1px color-mix(in oklab, var(--foreground) 20%, transparent), ${EDGE_DROP}`
        : hovered && !disabled
          ? `0 0 0 1px var(--border), ${EDGE_DROP}`
          : undefined;

    const handleSend = useCallback(() => {
      if (!canSend) return;
      onSend?.(trimmed, filesArr);
    }, [canSend, onSend, trimmed, filesArr]);

    const handleStop = useCallback(() => onStop?.(), [onStop]);

    // Send button morph: Stop (streaming + empty draft) ⇄ Send. Only the
    // Stop⇄arrow swap animates.
    const buttonMode: "send" | "stop" = streaming && !canSend && onStop ? "stop" : "send";
    const buttonLabel = buttonMode === "stop" ? "Stop" : sendLabel;
    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>) => {
        editorProps?.onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.nativeEvent.isComposing) return;

        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      [handleSend, editorProps]
    );

    const handleContainerMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (disabled) return;
        const target = e.target as HTMLElement;
        if (
          target.closest(
            'button, a, input, select, textarea, [contenteditable], [role="button"], [data-im-queue]'
          )
        ) {
          return;
        }
        e.preventDefault();
        editorHandle.current?.focus();
      },
      [disabled]
    );

    // ── File helpers ──────────────────────────────────────────────────
    const acceptTokens = useMemo(
      () => accept.split(",").map((s) => s.trim()).filter(Boolean),
      [accept]
    );

    const matchesAccept = useCallback(
      (file: File) =>
        acceptTokens.some((token) => {
          if (token === "*/*") return true;
          if (token.endsWith("/*")) return file.type.startsWith(token.slice(0, -1));
          if (token.startsWith(".")) return file.name.toLowerCase().endsWith(token.toLowerCase());
          return file.type === token;
        }),
      [acceptTokens]
    );

    const addFiles = useCallback(
      (incoming: File[]) => {
        if (!onFilesChange) return;
        // Identity key for dedup: name + size + lastModified is unique enough
        // to catch "user dropped the same file twice" without false positives
        // on legitimately distinct files (different bytes ⇒ different size).
        const fingerprint = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;
        const existing = new Set(filesArr.map(fingerprint));
        const accepted: File[] = [];
        for (const f of incoming) {
          if (!matchesAccept(f)) continue;
          const fp = fingerprint(f);
          if (existing.has(fp)) continue;
          existing.add(fp);
          accepted.push(f);
        }
        if (!accepted.length) return;
        const next = [...filesArr, ...accepted];
        onFilesChange(next);
      },
      [onFilesChange, filesArr, matchesAccept]
    );

    const removeFile = useCallback(
      (idx: number) => {
        if (!onFilesChange) return;
        onFilesChange(filesArr.filter((_, i) => i !== idx));
      },
      [onFilesChange, filesArr]
    );

    const openFilePicker = useCallback(
      (overrideAccept?: string) => {
        const el = fileInputRef.current;
        if (!el) return;
        // Temporarily narrow `accept` for this invocation (e.g. "image/*").
        // Reset after the click so subsequent native invocations still honor
        // the component-level accept.
        if (overrideAccept) {
          el.accept = overrideAccept;
          el.click();
          // Restore on next tick — the picker dialog reads `accept` synchronously.
          queueMicrotask(() => {
            if (fileInputRef.current) fileInputRef.current.accept = accept;
          });
          return;
        }
        el.click();
      },
      [accept]
    );

    // ── Slot rendering ────────────────────────────────────────────────
    const slotCtx = useMemo<InputMessageSlotContext>(
      () => ({ openFilePicker, files: filesArr }),
      [openFilePicker, filesArr]
    );
    const leftContent =
      typeof leftSlot === "function" ? leftSlot(slotCtx) : leftSlot;
    const rightContent =
      typeof rightSlot === "function" ? rightSlot(slotCtx) : rightSlot;

    // ── Drag-and-drop ────────────────────────────────────────────────
    const handleDragOver = useCallback(
      (e: ReactDragEvent<HTMLDivElement>) => {
        if (!supportsFiles || disabled) return;
        // Only treat as a file drag — text/HTML drags shouldn't trigger.
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      },
      [supportsFiles, disabled]
    );

    const handleDragLeave = useCallback(
      (e: ReactDragEvent<HTMLDivElement>) => {
        const wrapper = e.currentTarget;
        const next = e.relatedTarget as Node | null;
        if (next && wrapper.contains(next)) return;
        setDragOver(false);
      },
      []
    );

    const handleDrop = useCallback(
      (e: ReactDragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        if (!supportsFiles || disabled) return;
        addFiles(Array.from(e.dataTransfer.files));
      },
      [supportsFiles, disabled, addFiles]
    );

    const handleFileInputChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        addFiles(Array.from(e.target.files));
        e.target.value = ""; // Allow re-selecting the same file.
      },
      [addFiles]
    );

    // A pasted file the composer accepts (a screenshot, a copied image file)
    // attaches instead of pasting its name as text.
    const handlePaste = useCallback(
      (e: ReactClipboardEvent<HTMLDivElement>) => {
        editorOnPaste?.(e);
        if (e.defaultPrevented || !supportsFiles || disabled) return;
        const pasted = Array.from(e.clipboardData.files);
        if (!pasted.some(matchesAccept)) return;
        e.preventDefault();
        addFiles(pasted);
      },
      [editorOnPaste, supportsFiles, disabled, matchesAccept, addFiles]
    );

    const composer = (
      <div
        ref={ref}
        onMouseDown={handleContainerMouseDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          // The edge is the box-shadow's hairline ring (from surface-2), not a
          // border. State changes recolor that same 1px ring in place rather
          // than layering a second colored border beside it — so hover / focus
          // bump *contrast* without ever appearing to thicken the stroke.
          "flex flex-col gap-1 p-2 transition-[box-shadow,color] duration-80",
          surfaceClasses(2, 2),
          shape.container,
          !disabled && "cursor-text",
          disabled && "opacity-50 pointer-events-none",
          className
        )}
        style={edgeShadow ? { boxShadow: edgeShadow, ...style } : style}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        {...props}
      >
        <SurfaceProvider value={2}>
          {supportsFiles && (
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple
              className="hidden"
              onChange={handleFileInputChange}
              aria-hidden="true"
              tabIndex={-1}
            />
          )}

          {/* Attached files preview row — sits above the text field.
              The outer motion.div animates the row's height (collapsing the
              whole component height) when files appear / disappear.
              The inner `mode="popLayout"` AnimatePresence pulls a removing
              tile out of layout flow so siblings can slide into the gap
              without fighting its exit anim. Keys are purely file-identity
              (no index) so removing the first file doesn't re-key — and
              remount — every surviving sibling. */}
          <AnimatePresence initial={false}>
            {filesArr.length > 0 && (
              <motion.div
                key="preview-row"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: filesRegionHeight ?? 0, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ ...spring.moderate, bounce: 0 }}
                className="overflow-hidden"
              >
                <div ref={filesRegionRef} className="flex flex-wrap gap-2 pb-1">
                  <AnimatePresence initial={false} mode="popLayout">
                    {filesArr.map((file, i) => (
                      <FilePreviewTile
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        file={file}
                        onRemove={() => removeFile(i)}
                        size={80}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {beforeEditor}

          <div className="relative">
            <PromptEditor
              handle={setEditorHandle}
              value={value}
              onValueChange={onValueChange}
              disabled={disabled}
              // Capture phase: these run before the editor's own key and
              // paste handling, which leaves alone what they prevent.
              onKeyDownCapture={handleKeyDown}
              onPasteCapture={handlePaste}
              // Compose the consumer's editorProps handlers with the internal
              // focus-visible tracking (the spread below would otherwise
              // overwrite these).
              onFocus={(e) => {
                if (e.target.matches(":focus-visible")) setFocusVisible(true);
                editorProps?.onFocus?.(e);
              }}
              onBlur={(e) => {
                setFocusVisible(false);
                editorProps?.onBlur?.(e);
              }}
              aria-label={editorLabel ?? "Message"}
              aria-multiline
              className={cn(
                "w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent outline-none",
                "text-foreground",
                compactStep
                  ? "text-[13px] leading-[18px] px-1.5 py-1.5"
                  : "text-[14px] leading-5 px-2 py-2"
              )}
              style={{
                fontVariationSettings: fontWeights.normal,
                minHeight: minRows * (compactStep ? 18 : 20) + (compactStep ? 12 : 16),
                maxHeight: maxRows * (compactStep ? 18 : 20) + (compactStep ? 12 : 16),
              }}
              {...restEditorProps}
            />
            {value === "" && (
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-0 truncate text-muted-foreground",
                  compactStep
                    ? "text-[13px] leading-[18px] px-1.5 py-1.5"
                    : "text-[14px] leading-5 px-2 py-2"
                )}
                style={{ fontVariationSettings: fontWeights.normal }}
              >
                {dragOver && supportsFiles ? "Drop files here to add to chat" : placeholder}
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex items-center justify-between",
              // The footer's controls sit one notch below the composer's step:
              // slot content is consumer-authored (usually sm/icon-sm pinned
              // Buttons), so the compact step scales any button in the row —
              // send button included — down to 24px via a scoped override.
              compactStep
                ? "gap-1.5 [&_button]:h-6 [&_button.w-7]:w-6 [&_button]:text-[11px]"
                : "gap-2"
            )}
          >
            <div className="flex items-center gap-1.5 min-w-0">{leftContent}</div>
            <div className="flex items-center gap-1.5 shrink-0">
              {rightContent}
              <Tooltip
                content={buttonLabel}
                shortcut={buttonMode === "stop" ? stopShortcut : ["Enter"]}
                side="top"
              >
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={buttonMode === "stop" ? handleStop : handleSend}
                  disabled={buttonMode === "stop" ? disabled : !canSend}
                  loading={buttonMode === "stop" ? stopping : sending}
                  aria-label={buttonLabel}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={buttonMode === "stop" ? "stop" : "arrow"}
                      initial={
                        reduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.6 }
                      }
                      animate={{ opacity: 1, scale: 1 }}
                      exit={
                        reduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.6, transition: spring.fast.exit }
                      }
                      transition={spring.fast}
                      className="flex items-center justify-center leading-none"
                    >
                      {buttonMode === "stop" ? (
                        <span className="h-3 w-3 rounded-[3px] bg-current" />
                      ) : (
                        // Override icon-sm's small 14px svg — the send glyph reads
                        // better a touch larger. `size` matches the attribute to
                        // the CSS so the svg box stays centered.
                        <ArrowUpIcon
                          size={compactStep ? 15 : 19}
                          className={cn(
                            "block",
                            compactStep
                              ? "!h-[15px] !w-[15px]"
                              : "!h-[19px] !w-[19px]"
                          )}
                        />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </Button>
              </Tooltip>
            </div>
          </div>

          {afterActions}
        </SurfaceProvider>
      </div>
    );

    // A size prop pins the whole composer — inner buttons and rows included —
    // to one ladder step (matches InputGroup).
    return size ? <SizeProvider size={size}>{composer}</SizeProvider> : composer;
  }
));

InputMessage.displayName = "InputMessage";

export { InputMessage };
