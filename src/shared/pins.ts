/** The sessions the sidebar pins, by session id. The server keeps them, so the routine runner can pin with no page open and every window agrees. */

/** Pins or unpins `sessionIds`; a change sent twice leaves the pins as one did, so it never toggles. */
export interface PinChange {
	op: "pin" | "unpin";
	sessionIds: string[];
}

/** `pins` after `change`, or `pins` itself when it changes nothing. A new pin joins at the end. */
export function applyPins(pins: string[], { op, sessionIds }: PinChange): string[] {
	const next = op === "pin" ? [...pins, ...new Set(sessionIds.filter(id => !pins.includes(id)))] : pins.filter(id => !sessionIds.includes(id));
	return next.length === pins.length ? pins : next;
}
