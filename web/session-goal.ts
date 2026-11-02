import { keyedStore } from "./keyed-store";

/** A palette request survives opening its session's pane, then the header consumes it. */
export const goalDialogs = keyedStore(false);
