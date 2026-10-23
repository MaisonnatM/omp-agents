/** Tells how a provider's error ended a turn, the way omp's own retry and credential rotation tell it. */
import { isObject, nonEmptyStr, num, str } from "../json";
import { errorFlags, fetchRetry } from "./modules";

/**
 * How a provider's error ended a turn, `provider` naming it as omp does (`anthropic`): its usage or quota limit, with the wait
 * its error named, if it named one, or a transient network or provider fault, such as a lookup that failed or a stream that stalled.
 */
export type TurnFailure = { kind: "usage-limit"; provider: string; retryAfterMs: number | null } | { kind: "transient"; provider: string };

/**
 * How the last assistant message among `messages`, an `agent_end`'s, failed; `null` when the turn ended any other way, an abort
 * or an error neither kind included. A usage limit wins over a transient fault, as omp's retry decides. omp flags the message's
 * `errorId` as it records it and the classifier also reads the error's text, so a message without the flag still counts.
 */
export function turnFailureOf(messages: unknown): TurnFailure | null {
	if (!Array.isArray(messages)) return null;
	const last: unknown = messages.findLast(message => isObject(message) && message.role === "assistant");
	if (!isObject(last) || last.stopReason !== "error") return null;
	const provider = nonEmptyStr(last.provider);
	const errorMessage = str(last.errorMessage);
	if (!provider || !errorMessage) return null;
	const id = errorFlags.classifyMessage({
		api: str(last.api),
		provider,
		model: str(last.model),
		errorId: num(last.errorId),
		errorMessage,
		errorClassificationMessage: str(last.errorClassificationMessage),
		errorStatus: num(last.errorStatus),
	});
	if (errorFlags.is(id, errorFlags.Flag.UsageLimit)) return { kind: "usage-limit", provider, retryAfterMs: fetchRetry.extractRetryHint(null, errorMessage) ?? null };
	return errorFlags.is(id, errorFlags.Flag.Transient) ? { kind: "transient", provider } : null;
}
