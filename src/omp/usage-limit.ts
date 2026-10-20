/** Tells a turn that a provider's usage or quota limit ended, the way omp's own retry and credential rotation tell it. */
import { isObject, nonEmptyStr, num, str } from "../json";
import { errorFlags, fetchRetry } from "./modules";

/** A turn a provider's usage limit ended: the provider that refused, as omp names it (`anthropic`), and the wait its error named, if it named one. */
export interface UsageLimitHit {
	provider: string;
	retryAfterMs: number | null;
}

/**
 * The usage limit the last assistant message among `messages`, an `agent_end`'s, failed on; `null` when the turn ended
 * any other way. omp flags the message's `errorId` as it records it and the classifier also reads the error's text, so
 * a message without the flag still counts.
 */
export function usageLimitOf(messages: unknown): UsageLimitHit | null {
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
	if (!errorFlags.is(id, errorFlags.Flag.UsageLimit)) return null;
	return { provider, retryAfterMs: fetchRetry.extractRetryHint(null, errorMessage) ?? null };
}
