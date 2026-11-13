/** When the desktop shell starts a server that stopped again, and when it gives up and shows why. */

/** The waits before each restart, and how long a stop counts toward giving up. */
export interface RestartPolicy {
	delaysMs: readonly number[];
	windowMs: number;
}

/** 1, 2, 5, then 15 s; the 5th stop within 5 minutes gives up. */
export const RESTART_POLICY: RestartPolicy = { delaysMs: [1_000, 2_000, 5_000, 15_000], windowMs: 5 * 60_000 };

/** When the server stopped after it had listened, oldest first. */
export type Losses = readonly number[];

export type AfterLoss = { kind: "restart"; delayMs: number; losses: Losses } | { kind: "give-up"; losses: Losses };

/**
 * What follows a stop at `at`: a restart after the wait its count within the window earns, or giving up once it is one
 * more than there are waits. Stops older than the window no longer count.
 */
export function afterLoss(losses: Losses, at: number, policy: RestartPolicy = RESTART_POLICY): AfterLoss {
	const counted = [...losses.filter(loss => at - loss < policy.windowMs), at];
	const delayMs = policy.delaysMs[counted.length - 1];
	return delayMs === undefined ? { kind: "give-up", losses: counted } : { kind: "restart", delayMs, losses: counted };
}
