"use client";

import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { useSize, type SizeVariant } from "@/lib/size-context";
import { useTouchPrimary } from "@/hooks/use-touch-primary";
import { useIcon } from "@/lib/icon-context";

interface ChatMessageProps
  extends Omit<HTMLMotionProps<"div">, "children"> {
  /** Who sent the message. Drives alignment and bubble colour:
   *  `user` → right-aligned accent bubble, `assistant` → left-aligned plain text. */
  from: "user" | "assistant";
  /** Names of files the message carried as text, shown as chips above the bubble. */
  files?: string[];
  /** Addresses of images the message carried, shown above the bubble. */
  images?: string[];
  /** Timestamp shown in the hover-revealed meta row, before the actions.
   *  User-message only — ignored on assistant replies. Caller pre-formats it
   *  (e.g. `"Wednesday 6:08 PM"`). */
  time?: ReactNode;
  /** Icon-only action buttons shown in the hover-revealed meta row (e.g. copy,
   *  edit, regenerate). Rendered next to the timestamp. */
  actions?: ReactNode;
  /** Message body. When omitted the text bubble is dropped (attachment-only message). */
  children?: ReactNode;
  /** Pins the message to one step of the size ladder (see /docs/sizes) —
   *  compact tightens bubble type and padding. Omitted, it follows the
   *  surrounding SizeProvider. */
  size?: SizeVariant;
}

// ─── ChatMessage ──────────────────────────────────────────────────────────
// A single transcript entry with baked-in entrance + layout motion. Pairs with
// InputMessage's onSend: render one per sent/received message. `layout="position"`
// lets earlier messages slide up smoothly when a new one is appended.
const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  (
    { from, files, images, time, actions, children, size, className, ...props },
    ref
  ) => {
    const shape = useShape();
    const FileIcon = useIcon("file-text");
    const compact = useSize(size).variant === "compact";
    const isUser = from === "user";
    // Hover-reveal is unreachable on touch — keep the meta row visible there.
    const isTouch = useTouchPrimary();
    // Timestamps are a user-message affordance; assistant replies show actions only.
    const showTime = isUser && time != null;

    return (
      <motion.div
        ref={ref}
        layout="position"
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring.moderate}
        style={{ transformOrigin: isUser ? "bottom right" : "bottom left" }}
        className={cn(
          "group/message flex max-w-[80%] flex-col gap-1.5",
          isUser ? "items-end self-end" : "items-start self-start",
          className
        )}
        {...props}
      >
        {files && files.length > 0 && (
          <div
            className={cn(
              "flex flex-wrap gap-1.5",
              isUser ? "justify-end" : "justify-start"
            )}
          >
            {files.map((name, i) => (
              // A message's files never change, so their order names them.
              <span
                key={i}
                title={name}
                className={cn(
                  "inline-flex h-7 max-w-60 items-center gap-1.5 px-2.5 text-[12px] text-muted-foreground bg-accent outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
                  shape.bg
                )}
              >
                <FileIcon size={14} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        )}
        {images && images.length > 0 && (
          <div
            className={cn(
              "flex flex-wrap gap-1.5",
              isUser ? "justify-end" : "justify-start"
            )}
          >
            {images.map((src, i) => (
              // A message's images never change, so their order names them.
              <img
                key={i}
                src={src}
                alt={`Attached image ${i + 1}`}
                loading="lazy"
                className={cn(
                  "max-h-60 max-w-full object-contain outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
                  shape.bg
                )}
              />
            ))}
          </div>
        )}
        {children != null && children !== "" && (
          <div
            className={cn(
              "max-w-full whitespace-pre-wrap break-words",
              compact ? "py-1.5 text-[13px]" : "py-2 text-[14px]",
              // User keeps the bubble chrome (rounded fill + horizontal padding);
              // the assistant reply is flush-left plain text with no background.
              isUser
                ? cn(
                    shape.bg,
                    compact ? "px-3" : "px-3.5",
                    // `text-pretty` is reserved for settled user bubbles. On the
                    // assistant reply it's left off on purpose: `text-wrap: pretty`
                    // re-balances the last lines on every content change, so a
                    // word-by-word stream visibly reflows earlier words to new
                    // lines. Default (normal) wrapping appends left-to-right and
                    // stays put as the text grows.
                    "text-pretty bg-[color-mix(in_oklab,var(--accent),var(--background)_45%)] text-accent-foreground"
                  )
                : "text-foreground"
            )}
          >
            {children}
          </div>
        )}
        {(showTime || actions != null) && (
          // Meta row: timestamp + icon-only actions. Always rendered (so it
          // reserves its height and the gap between bubbles never shifts) but
          // hidden until the message is hovered or an action is focused.
          // The timestamp is a user-message affordance only — assistant replies
          // show their actions alone. User rows read date → icons left-to-right.
          <div
            className={cn(
              "flex items-center gap-2 px-1 leading-none text-muted-foreground select-none",
              compact ? "text-[11px]" : "text-[12px]",
              !isTouch && [
                "opacity-0 pointer-events-none transition-opacity duration-150",
                "group-hover/message:opacity-100 group-hover/message:pointer-events-auto",
                "group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto",
              ]
            )}
          >
            {showTime && <span className="tabular-nums">{time}</span>}
            {actions != null && (
              <span className="flex items-center gap-0.5">{actions}</span>
            )}
          </div>
        )}
      </motion.div>
    );
  }
);

ChatMessage.displayName = "ChatMessage";

export { ChatMessage };
export type { ChatMessageProps };
export default ChatMessage;
