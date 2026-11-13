"use client";

import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from "react";

import type { CentralIconBaseProps } from "central-icons";
import { IconArrowCornerDownLeft, IconArrowCornerDownRight, IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowRotateCounterClockwise, IconArrowUp, IconBarsThree, IconBell, IconBrain, IconBranch, IconBubble2, IconCalendar1, IconChainLink1, IconCheckmark1, IconChevronBottom, IconChevronGrabberVertical, IconChevronRight, IconCircle, IconCircleInfo, IconCircleRecord, IconClock, IconColorPalette, IconCrossMedium, IconDotGrid1x3Horizontal, IconDotGrid1x3Vertical, IconEmail1, IconEyedropper, IconFileText, IconFolder1, IconFormRectangle, IconGlobe, IconGroup1, IconHeart, IconHome, IconImac, IconImages1, IconInboxEmpty, IconLibrary, IconLightBulb, IconLoader, IconLock, IconMagnifyingGlass, IconMoon, IconPaintBrush, IconPause, IconPencil, IconPlay, IconPlusLarge, IconResize, IconRocket, IconSettingsGear1, IconSettingsSliderHor, IconShield, IconSidebarSimpleLeftWide, IconSidebarSimpleRightWide, IconSquareBehindSquare1, IconStar, IconStepForwards, IconSun, IconUser } from "central-icons";

export type IconComponent = ComponentType<CentralIconBaseProps>;

export type IconName =
  | "chevron-right" | "chevron-down" | "x" | "copy" | "menu" | "dot"
  | "monitor" | "sun" | "moon" | "rectangle-horizontal" | "circle"
  | "square-library" | "clock" | "star" | "settings"
  | "plus" | "arrow-left" | "arrow-right" | "arrow-up" | "arrow-down"
  | "search" | "loader"
  | "users" | "lock" | "mail" | "bell" | "shield" | "palette"
  | "lightbulb" | "rocket" | "heart" | "paintbrush" | "brain"
  | "globe" | "user"
  | "image" | "file-text" | "link" | "check" | "rotate-ccw"
  | "play" | "pause" | "pipette"
  | "home" | "message-circle" | "inbox"
  | "pencil" | "scaling" | "skip-forward" | "corner-down-right" | "corner-down-left"
  | "panel-left" | "panel-right" | "chevrons-up-down" | "more-horizontal" | "more-vertical" | "calendar" | "folder"
  | "sliders-horizontal" | "info" | "git-branch";

export const defaultIcons: Record<IconName, IconComponent> = {
  "chevron-right": IconChevronRight,
  "chevron-down": IconChevronBottom,
  "pipette": IconEyedropper,
  "x": IconCrossMedium,
  "copy": IconSquareBehindSquare1,
  "menu": IconBarsThree,
  "dot": IconCircleRecord,
  "monitor": IconImac,
  "sun": IconSun,
  "moon": IconMoon,
  "rectangle-horizontal": IconFormRectangle,
  "circle": IconCircle,
  "square-library": IconLibrary,
  "clock": IconClock,
  "star": IconStar,
  "settings": IconSettingsGear1,
  "plus": IconPlusLarge,
  "arrow-left": IconArrowLeft,
  "arrow-right": IconArrowRight,
  "arrow-up": IconArrowUp,
  "arrow-down": IconArrowDown,
  "search": IconMagnifyingGlass,
  "loader": IconLoader,
  "users": IconGroup1,
  "lock": IconLock,
  "mail": IconEmail1,
  "bell": IconBell,
  "shield": IconShield,
  "palette": IconColorPalette,
  "lightbulb": IconLightBulb,
  "rocket": IconRocket,
  "heart": IconHeart,
  "paintbrush": IconPaintBrush,
  "brain": IconBrain,
  "globe": IconGlobe,
  "user": IconUser,
  "image": IconImages1,
  "file-text": IconFileText,
  "link": IconChainLink1,
  "check": IconCheckmark1,
  "rotate-ccw": IconArrowRotateCounterClockwise,
  "play": IconPlay,
  "pause": IconPause,
  "home": IconHome,
  "message-circle": IconBubble2,
  "inbox": IconInboxEmpty,
  "pencil": IconPencil,
  "scaling": IconResize,
  "skip-forward": IconStepForwards,
  "corner-down-right": IconArrowCornerDownRight,
  "corner-down-left": IconArrowCornerDownLeft,
  "panel-left": IconSidebarSimpleLeftWide,
  "panel-right": IconSidebarSimpleRightWide,
  "chevrons-up-down": IconChevronGrabberVertical,
  "more-horizontal": IconDotGrid1x3Horizontal,
  "more-vertical": IconDotGrid1x3Vertical,
  "calendar": IconCalendar1,
  "folder": IconFolder1,
  "sliders-horizontal": IconSettingsSliderHor,
  "info": IconCircleInfo,
  "git-branch": IconBranch,
};

const IconContext = createContext<Record<IconName, IconComponent> | null>(null);

/**
 * Returns a single icon component for the given name.
 * Falls back to the default (Central) set if no provider is present.
 */
function useIcon(name: IconName): IconComponent {
  const icons = useContext(IconContext);
  return (icons ?? defaultIcons)[name];
}

/**
 * Returns the full icon map.
 * Falls back to the default (Central) set if no provider is present.
 */
function useIcons(): Record<IconName, IconComponent> {
  const icons = useContext(IconContext);
  return icons ?? defaultIcons;
}

/**
 * Swap some or all icons for components from another library.
 * Names left out of `icons` keep their default (Central) component.
 */
function IconProvider({
  children,
  icons,
}: {
  children: ReactNode;
  icons?: Partial<Record<IconName, IconComponent>>;
}) {
  const value = useMemo(() => ({ ...defaultIcons, ...icons }), [icons]);
  return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}

export { IconProvider, useIcon, useIcons };
