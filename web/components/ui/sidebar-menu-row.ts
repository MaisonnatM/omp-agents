"use client";

import {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { MenuRegistryContext, MenuRowsContext } from "@/components/ui/sidebar-menu-scope";

// ─── Menu row ────────────────────────────────────────────────────────────────

export interface MenuItemContextValue {
  rowRef: RefObject<HTMLLIElement | null>;
  /** Ref callback for the row's <li> — also replays the row's active flag
   *  to the scope, covering the windows where the ref is detached. */
  attachRow: (node: HTMLLIElement | null) => void;
  isActiveRow: boolean;
  /** True inside SidebarMenuSubItem — actions center on the shorter row. */
  isSubRow: boolean;
  setActive: (active: boolean) => void;
  setButtonEl: (el: HTMLElement | null) => void;
  /** Trailing controls on this row, registered by the action / badge parts.
   *  The button turns them into an exact padding-right reservation. */
  actionCount: number;
  actionsShowOnHover: boolean;
  hasBadge: boolean;
  setActions: (count: number, showOnHover: boolean) => void;
  setHasBadge: (hasBadge: boolean) => void;
}

export const MenuItemContext = createContext<MenuItemContextValue | null>(null);

/** True while rendering inside a SidebarMenuActions cluster, where each
 *  action flows in the wrapper's row instead of positioning itself. */
export const MenuActionsClusterContext = createContext(false);

export function useMenuRow(
  rowRef: RefObject<HTMLLIElement | null>,
  isSubRow = false
): MenuItemContextValue {
  const registry = useContext(MenuRegistryContext);
  const rows = useContext(MenuRowsContext);
  const registerRow = registry?.registerRow;
  const setRowButton = registry?.setRowButton;
  const setRowActive = registry?.setRowActive;

  // The button's setActive effect can fire while this row's <li> ref is
  // detached: a child's layout effects run before its parent's ref attaches
  // — at mount, and on EVERY re-render whose inline ref identity changes
  // (React detaches the old callback, nulling the ref, before the layout
  // phase). The flag holds the truth through that window, and attachRow
  // re-syncs the scope whenever the <li> lands.
  const activeFlagRef = useRef(false);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || !registerRow) return;
    return registerRow(el);
  }, [registerRow, rowRef]);

  /** The <li>'s ref callback: tracks the element and replays the active flag
   *  the scope may have missed while the ref was detached. */
  const attachRow = useCallback(
    (node: HTMLLIElement | null) => {
      rowRef.current = node;
      if (node && setRowActive) setRowActive(node, activeFlagRef.current);
    },
    [setRowActive, rowRef]
  );

  const setActive = useCallback(
    (active: boolean) => {
      activeFlagRef.current = active;
      if (rowRef.current && setRowActive) setRowActive(rowRef.current, active);
    },
    [setRowActive, rowRef]
  );

  const setButtonEl = useCallback(
    (el: HTMLElement | null) => {
      if (rowRef.current && setRowButton) setRowButton(rowRef.current, el);
    },
    [setRowButton, rowRef]
  );

  const isActiveRow =
    rowRef.current !== null && (rows?.activeRows.includes(rowRef.current) ?? false);

  const [trailing, setTrailing] = useState({
    actionCount: 0,
    actionsShowOnHover: false,
    hasBadge: false,
  });
  const setActions = useCallback(
    (count: number, showOnHover: boolean) =>
      setTrailing((prev) =>
        prev.actionCount === count && prev.actionsShowOnHover === showOnHover
          ? prev
          : { ...prev, actionCount: count, actionsShowOnHover: showOnHover }
      ),
    []
  );
  const setHasBadge = useCallback(
    (hasBadge: boolean) =>
      setTrailing((prev) => (prev.hasBadge === hasBadge ? prev : { ...prev, hasBadge })),
    []
  );

  return useMemo(
    () => ({
      rowRef,
      attachRow,
      isActiveRow,
      isSubRow,
      setActive,
      setButtonEl,
      ...trailing,
      setActions,
      setHasBadge,
    }),
    [
      rowRef,
      attachRow,
      isActiveRow,
      isSubRow,
      setActive,
      setButtonEl,
      trailing,
      setActions,
      setHasBadge,
    ]
  );
}

// ─── Trailing-gutter math ────────────────────────────────────────────────────
//
// The label reserves exactly the trailing run it has to clear, plus one gap
// — the same rule the section header's label follows, so a row's chevron and
// a section header's chevron each sit one 4px gap from their action run.
// A run is: the badge's 24px slot (rightmost when present), the action
// cluster (24px apiece, 4px between), and a gap where both appear.
const ROW_BASE_PAD = 8;
const ROW_SLOT = 24;
const ROW_GAP = 4;
/** Where the run's rightmost element sits, measured from the row's right
 *  edge: a badge at right-2, an action cluster at right-1.5 (its wider box
 *  puts both on the same centre line). */
const ROW_BADGE_INSET = 8;
const ROW_ACTION_INSET = 6;

export function rowGutter(actionCount: number, hasBadge: boolean) {
  if (!actionCount && !hasBadge) return ROW_BASE_PAD;
  const actionsWidth = actionCount
    ? actionCount * ROW_SLOT + (actionCount - 1) * ROW_GAP
    : 0;
  const runWidth =
    (hasBadge ? ROW_SLOT : 0) +
    actionsWidth +
    (hasBadge && actionCount ? ROW_GAP : 0);
  const inset = hasBadge ? ROW_BADGE_INSET : ROW_ACTION_INSET;
  return inset + runWidth + ROW_GAP;
}
