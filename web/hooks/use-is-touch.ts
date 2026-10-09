"use client";

import { useEffect, useState } from "react";

// Touch devices have no hover, so hover-revealed affordances (like a queued
// row's × button) would never appear. `(hover: none)` flags those so they can
// be shown persistently instead. SSR-safe: starts false, resolves on mount.
export function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const update = () => setIsTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isTouch;
}
