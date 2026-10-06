// Writes the conversation part of Anthropic prompt caching at the 5-minute tier, while the tool definitions and the
// system prompt keep the 1-hour tier omp gives Claude subscription sessions.
// A 1-hour cache write costs 2x the input price and a 5-minute one 1.25x. The head is written once and read for the
// whole session, but each turn writes a new conversation tail that the next request, usually seconds later, reads.
// After a pause longer than five minutes only the tail is written again, and the head stays cached.
// Anthropic requires 1-hour breakpoints before 5-minute ones; the head comes first on the wire, so the mix is valid.
// OMP_CACHE_TAIL_TTL=1h leaves every breakpoint as omp wrote it.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

interface CacheControl {
	type: string;
	ttl?: string;
}

function hasCacheControl(block: unknown): block is { cache_control: CacheControl } {
	return typeof block === "object" && block !== null && "cache_control" in block && block.cache_control != null;
}

export default function cacheTail(pi: ExtensionAPI) {
	if (process.env.OMP_CACHE_TAIL_TTL === "1h") return;

	pi.on("before_provider_request", event => {
		const payload = event.payload as { messages?: Array<{ content?: unknown }> } | null;
		if (!payload || !Array.isArray(payload.messages)) return;
		for (const message of payload.messages) {
			if (!Array.isArray(message.content)) continue;
			for (const block of message.content) {
				if (hasCacheControl(block) && block.cache_control.ttl === "1h") delete block.cache_control.ttl;
			}
		}
		return payload;
	});

	// The warmer prices a lost entry as a rewrite of the whole prompt, but here an idle pause loses only the tail,
	// so a refresh while idle costs more than it saves. Before this extension the 1-hour entry outlived the warmer's
	// 30-minute idle window and idle refreshes never ran, so stopping them keeps that behavior.
	pi.on("cache_warming_decision", (_event, ctx) => (ctx.isIdle() ? { action: "stop" } : undefined));
}
