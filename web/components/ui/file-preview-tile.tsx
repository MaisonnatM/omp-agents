"use client";

import { motion } from "framer-motion";
import { spring } from "@/lib/springs";
import { nestedRadius, useShape } from "@/lib/shape-context";
import { useIcon } from "@/lib/icon-context";
import { FileThumbnail } from "@/components/ui/file-thumbnail";
import { Tooltip } from "@/components/ui/tooltip";

// ─── File preview tile ────────────────────────────────────────────────────
// Composer-row tile: a FileThumbnail wrapped with enter/exit motion and a
// hover-revealed remove (×) button.
interface FilePreviewTileProps {
  file: File;
  onRemove: () => void;
  size: number;
}

export function FilePreviewTile({ file, onRemove, size }: FilePreviewTileProps) {
  const XIcon = useIcon("x");
  const shape = useShape();
  // The tile sits 8px inside the composer's container edge. Derive its curve
  // from that actual inset instead of reusing the popup-specific 4px pair.
  const radius = nestedRadius(shape.containerRadius, 8);

  return (
    <motion.div
      // `layout` animates sibling tiles into the gap when one is removed.
      // Enter: spring.fast (0.08s) — the small-state-flip tier per motion-guidelines.md.
      // Exit: 0.06s linear — "exits should be slightly faster than enter",
      // matches CheckboxGroup's hover-bg pattern.
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: spring.fast.exit }}
      transition={spring.fast}
      // `cursor-default` opts out of the parent's `cursor-text` so hovering
      // a preview tile doesn't look like it'll land in the text field.
      className="relative shrink-0 cursor-default group/tile"
    >
      <FileThumbnail file={file} size={size} radius={radius} />
      <Tooltip content="Remove" side="top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${file.name}`}
          // Force the light-mode palette (dark circle + white X) regardless
          // of theme — the close badge needs to read as a "delete affordance"
          // over arbitrary image/PDF content, so it sits at a fixed contrast
          // instead of flipping with the surrounding surface.
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-neutral-900 text-white opacity-0 group-hover/tile:opacity-100 transition-opacity duration-80 flex items-center justify-center cursor-pointer outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
        >
          <XIcon size={12} strokeWidth={2.5} />
        </button>
      </Tooltip>
    </motion.div>
  );
}
