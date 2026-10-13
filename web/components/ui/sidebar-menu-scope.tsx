"use client";

import {
  createContext,
  useState,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { useFluidHover, type ItemRect } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";

// ─── Menu scope ──────────────────────────────────────────────────────────────
//
// One scope per SidebarMenu tree: a single fluid-hover system plus the
// traveling overlays — hover background, active background(s), focus ring —
// that glide between every visible row.
//
// Hover never re-renders a row: the fluid hover hook stamps
// `data-fluid-hover-active` on the hovered row's button, and the row lights
// itself from that attribute in CSS. Only the scope's overlays follow the
// hover in React.

/** Stable callbacks rows use to tell the scope about themselves. */
export interface MenuRegistry {
  registerRow: (el: HTMLElement) => () => void;
  setRowButton: (row: HTMLElement, button: HTMLElement | null) => void;
  setRowActive: (row: HTMLElement, active: boolean) => void;
}

/** What rows read back: changes only when rows register or turn active. */
export interface MenuRows {
  /** Every active row, in DOM order. */
  activeRows: HTMLElement[];
  firstRowEl: HTMLElement | null;
  hasActive: boolean;
}

export const MenuRegistryContext = createContext<MenuRegistry | null>(null);
export const MenuRowsContext = createContext<MenuRows | null>(null);

/** True for a disabled row: it stays in the list (and in the layout) but is
 *  never lit, never takes a routed click, and is skipped by the keyboard.
 *  The hook registers the row's button (falling back to the row itself), so
 *  check the element first, then a button directly inside it. */
const DISABLED_CONTROL = ':disabled, [aria-disabled="true"]';
function rowDisabled(el: HTMLElement) {
  return (
    el.matches(DISABLED_CONTROL) ||
    el.querySelector(`:scope > [data-sidebar="menu-button"]:is(${DISABLED_CONTROL})`) !== null
  );
}

function byDomOrder(a: HTMLElement, b: HTMLElement) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function sameElements(a: HTMLElement[], b: HTMLElement[]) {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}

/** What a flush must redo: re-sort and re-register the rows (which also
 *  recomputes the active set), or only recompute the active set. */
type Dirty = "none" | "active" | "rows";

interface MenuScope {
  registry: MenuRegistry;
  rows: MenuRows;
  containerProps: {
    onMouseEnter: () => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    /** A click between rows lands on the highlighted row's button. */
    onClick: (e: React.MouseEvent) => void;
    onFocus: (e: React.FocusEvent) => void;
    onBlur: (e: React.FocusEvent) => void;
    onPointerDown: () => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
  };
  overlays: ReactNode;
}

interface MenuScopeOptions {
  /** Draw the traveling keyboard focus ring. Off, keyboard focus moves the
   *  hover background only — for menus whose rows are the whole surface,
   *  like a settings dialog's section list. @default true */
  focusRing?: boolean;
}

export function useMenuScope(
  containerRef: RefObject<HTMLElement | null>,
  { focusRing = true }: MenuScopeOptions = {}
): MenuScope {
  const {
    activeIndex,
    setActiveIndex,
    itemRects,
    isMeasured,
    sessionRef,
    handlers,
    registerItem,
  } = useFluidHover(containerRef, { isItemDisabled: rowDisabled });

  const rowsRef = useRef<Set<HTMLElement>>(new Set());
  const rowButtonsRef = useRef<Map<HTMLElement, HTMLElement>>(new Map());
  const activeMapRef = useRef<Map<HTMLElement, boolean>>(new Map());
  const [orderedRows, setOrderedRows] = useState<HTMLElement[]>([]);
  const orderedRowsRef = useRef(orderedRows);
  orderedRowsRef.current = orderedRows;
  /** The element registered with the fluid hover hook at each index. */
  const registeredRef = useRef<HTMLElement[]>([]);
  const [activeRows, setActiveRows] = useState<HTMLElement[]>([]);
  const [focusedRowEl, setFocusedRowEl] = useState<HTMLElement | null>(null);

  const rowButton = useCallback(
    (row: HTMLElement) =>
      rowButtonsRef.current.get(row) ??
      row.querySelector<HTMLElement>(':scope > [data-sidebar="menu-button"]'),
    []
  );

  // Registration only marks the scope dirty; one flush per commit applies
  // every change. A list of rows mounting would otherwise sort the whole set
  // and re-register every row once per row. The flush runs from the scope's
  // own layout effect — after its rows' effects, before paint — and from a
  // microtask for commits that changed rows without re-rendering the scope.
  const dirtyRef = useRef<Dirty>("none");
  const flushQueuedRef = useRef(false);
  const mountedRef = useRef(false);

  const flush = useCallback(() => {
    flushQueuedRef.current = false;
    const dirty = dirtyRef.current;
    if (dirty === "none" || !mountedRef.current) return;
    dirtyRef.current = "none";
    if (dirty === "rows") {
      // Rows register by element; indexes are derived from DOM order so
      // consumers never pass an index prop and conditional rows just work.
      // The fluid hover system measures the row's BUTTON, not the <li>, so
      // overlays fit the button strip the row actually draws.
      const sorted = [...rowsRef.current].sort(byDomOrder);
      orderedRowsRef.current = sorted;
      setOrderedRows((prev) => (sameElements(prev, sorted) ? prev : sorted));
      const next = sorted.map((el) => rowButton(el) ?? el);
      const prev = registeredRef.current;
      // Only indexes whose element changed are touched: release them all
      // first, so an element moving to another index drops its hover mark
      // and observer before it registers under the new one.
      for (let i = 0; i < prev.length; i++) {
        if (prev[i] !== next[i]) registerItem(i, null);
      }
      for (let i = 0; i < next.length; i++) {
        if (prev[i] !== next[i]) registerItem(i, next[i]);
      }
      registeredRef.current = next;
    }
    const active = orderedRowsRef.current.filter(
      (el) => activeMapRef.current.get(el) && !rowDisabled(el)
    );
    setActiveRows((prev) => (sameElements(prev, active) ? prev : active));
  }, [registerItem, rowButton]);

  const markDirty = useCallback(
    (level: Exclude<Dirty, "none">) => {
      if (dirtyRef.current !== "rows") dirtyRef.current = level;
      if (flushQueuedRef.current) return;
      flushQueuedRef.current = true;
      queueMicrotask(flush);
    },
    [flush]
  );

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    flush();
  });

  const registerRow = useCallback(
    (el: HTMLElement) => {
      rowsRef.current.add(el);
      markDirty("rows");
      return () => {
        rowsRef.current.delete(el);
        rowButtonsRef.current.delete(el);
        activeMapRef.current.delete(el);
        markDirty("rows");
      };
    },
    [markDirty]
  );

  const setRowButton = useCallback(
    (row: HTMLElement, button: HTMLElement | null) => {
      if (button) rowButtonsRef.current.set(row, button);
      else rowButtonsRef.current.delete(row);
      // The button is the row's measured element, so a button arriving after
      // its row registered must re-sync what the fluid hover system observes.
      markDirty("rows");
    },
    [markDirty]
  );

  const setRowActive = useCallback(
    (row: HTMLElement, active: boolean) => {
      if (activeMapRef.current.get(row) === active) return;
      activeMapRef.current.set(row, active);
      markDirty("active");
    },
    [markDirty]
  );

  const overlayRect = useCallback(
    (row: HTMLElement | null): ItemRect | null => {
      if (!row) return null;
      const idx = orderedRowsRef.current.indexOf(row);
      return idx === -1 ? null : itemRects[idx] ?? null;
    },
    [itemRects]
  );

  // While a popup anchored in the sidebar is open (a row action's or the
  // header/footer rows' dropdown), hover tracking freezes across every menu
  // scope — otherwise a non-modal popup lets rows underneath keep
  // highlighting. Popup triggers are detected by the primitives' open
  // attributes (Radix data-state, Base UI data-popup-open); collapsible rows
  // only set aria-expanded, so they never match.
  const popupOpen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const root = container.closest('[data-slot="sidebar-wrapper"]') ?? container;
    return !!root.querySelector(
      '[data-sidebar="menu-button"][data-state="open"], [data-sidebar="menu-button"][data-popup-open], [data-sidebar="menu-action"][data-state="open"], [data-sidebar="menu-action"][data-popup-open]'
    );
  }, [containerRef]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (popupOpen()) return;
      handlers.onMouseMove(e);
    },
    [popupOpen, handlers]
  );

  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      const target = e.target as HTMLElement;
      // Only the row's main button drives the traveling highlight and ring —
      // actions keep their own static focus rings.
      if (!target.closest('[data-sidebar="menu-button"]')) return;
      const row = target.closest('[data-sidebar="menu-item"]') as HTMLElement | null;
      if (!row) return;
      const idx = orderedRowsRef.current.indexOf(row);
      if (idx === -1) return;
      setActiveIndex(idx);
      setFocusedRowEl(target.matches(":focus-visible") ? row : null);
    },
    [setActiveIndex]
  );

  const onPointerDown = useCallback(() => {
    setFocusedRowEl(null);
  }, []);

  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      if (containerRef.current?.contains(e.relatedTarget as Node)) return;
      setFocusedRowEl(null);
      setActiveIndex(null);
    },
    [containerRef, setActiveIndex]
  );

  // Arrow/Home/End over every row button in DOM order.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key))
        return;
      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')
      );
      const currentIdx = items.indexOf(e.target as HTMLElement);
      if (currentIdx === -1) return;
      e.preventDefault();
      // Keep handled arrows from also reaching window-level listeners, which
      // would act on the same key a second time.
      e.stopPropagation();
      if (e.key === "Home") items[0]?.focus();
      else if (e.key === "End") items[items.length - 1]?.focus();
      else {
        const next = ["ArrowDown", "ArrowRight"].includes(e.key)
          ? (currentIdx + 1) % items.length
          : (currentIdx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    },
    [containerRef]
  );

  const hoveredRowEl = activeIndex !== null ? orderedRows[activeIndex] ?? null : null;

  const registry = useMemo<MenuRegistry>(
    () => ({ registerRow, setRowButton, setRowActive }),
    [registerRow, setRowButton, setRowActive]
  );
  const firstRowEl = orderedRows[0] ?? null;
  const rows = useMemo<MenuRows>(
    () => ({ activeRows, firstRowEl, hasActive: activeRows.length > 0 }),
    [activeRows, firstRowEl]
  );

  const shape = useShape();
  // Every active row gets its own background — the buttons' own text styling
  // already lights each active row, so the overlays must match. Keys are the
  // row's occurrence among the active rows, so the background GLIDES when
  // the selection moves instead of remounting.
  // A rect change has two causes with two right answers. The highlight moving
  // to a DIFFERENT row springs — that's the glide. The same row itself moving
  // — rows above it reflowing — must snap, or the overlay chases the row it
  // is sitting on with a trailing second spring. Targets are compared against
  // the previous COMMIT (the effect below), not the previous render, so
  // strict mode's double render can't eat a genuine row change.
  const prevTargetsRef = useRef<{
    hover: HTMLElement | null;
    focus: HTMLElement | null;
    actives: HTMLElement[];
  }>({ hover: null, focus: null, actives: [] });

  const activeRects: {
    key: number;
    rect: ItemRect;
    rowChanged: boolean;
  }[] = [];
  activeRows.forEach((row, occurrence) => {
    const rect = overlayRect(row);
    if (rect)
      activeRects.push({
        key: occurrence,
        rect,
        rowChanged: prevTargetsRef.current.actives[occurrence] !== row,
      });
  });
  const hoverRect = overlayRect(hoveredRowEl);
  const focusRect = focusRing ? overlayRect(focusedRowEl) : null;
  const hoverRowChanged = prevTargetsRef.current.hover !== hoveredRowEl;
  const focusRowChanged = prevTargetsRef.current.focus !== focusedRowEl;

  useLayoutEffect(() => {
    prevTargetsRef.current = {
      hover: hoveredRowEl,
      focus: focusedRowEl,
      actives: activeRows,
    };
  });

  const overlays = isMeasured ? (
    <>
      {/* Active row backgrounds — one per active row (see activeRects above) */}
      <AnimatePresence>
        {activeRects.map(({ key, rect, rowChanged }) => (
          <motion.div
            key={key}
            className={`absolute ${shape.bg} bg-active pointer-events-none`}
            initial={false}
            animate={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              opacity: 1,
            }}
            exit={{ opacity: 0, transition: spring.moderate.exit }}
            transition={
              rowChanged
                ? { ...spring.moderate, opacity: { duration: 0.08 } }
                : { duration: 0 }
            }
          />
        ))}
      </AnimatePresence>

      {/* Hover background. Fades in at the first hovered row; snaps (no
          travel) when only a reflow moved the rows underneath. */}
      <FluidHoverHighlight
        rect={hoverRect}
        session={sessionRef.current}
        className={shape.bg}
        transition={hoverRowChanged ? undefined : false}
      />

      {/* Focus ring */}
      <AnimatePresence>
        {focusRect && (
          <motion.div
            className={`absolute ${shape.focusRing} pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]`}
            initial={false}
            animate={{
              left: focusRect.left - 2,
              top: focusRect.top - 2,
              width: focusRect.width + 4,
              height: focusRect.height + 4,
            }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={
              focusRowChanged
                ? { ...spring.fast, opacity: { duration: 0.08 } }
                : { duration: 0 }
            }
          />
        )}
      </AnimatePresence>
    </>
  ) : null;

  return {
    registry,
    rows,
    containerProps: {
      onMouseEnter: handlers.onMouseEnter,
      onMouseMove,
      onMouseLeave: handlers.onMouseLeave,
      onClick: handlers.onClick,
      onFocus,
      onBlur,
      // Pointer interaction switches modality back to pointer. Clicking the
      // already-focused row never re-fires focus, so without this the
      // keyboard ring would stick until focus left the menu.
      onPointerDown,
      onKeyDown,
    },
    overlays,
  };
}
