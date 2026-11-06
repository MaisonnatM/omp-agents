/** One activity event. The socket message that carries a batch of them lives in `protocol.ts`, which this file does not import. */

/** A page or settings section shown, a shortcut run, a socket message or `PUT` sent, a tagged control clicked, or the window coming to the foreground or leaving it. */
export const ACTIVITY_KINDS = ["view", "command", "action", "control", "presence"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** How a command ran: its shortcut's key, or the command palette. */
export const ACTIVITY_VIAS = ["keyboard", "palette"] as const;

export type ActivityVia = (typeof ACTIVITY_VIAS)[number];

/** One thing the user did, at `at` ms. `key` is a registry id, never user content; `via` is set on commands only. */
export interface ActivityEvent {
	kind: ActivityKind;
	key: string;
	via: ActivityVia | null;
	at: number;
}
