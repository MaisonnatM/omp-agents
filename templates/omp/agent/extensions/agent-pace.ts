// Ends every tool-results message sent to Anthropic with the time since the prompt and a batching nudge.
// Opus 5.5 made one tool call in 82% of its tool turns here, against 44% for Fable 5.2, under the same system prompt.
// Anthropic's fix for that is a one-sentence nudge after each tool-results message, and its Opus 5.5 guide reports that
// an elapsed-time line makes agents finish sooner:
// https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
// https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
// Each message keeps the text it first got, so the conversation prefix stays byte-identical and its cache keeps hitting.
// OMP_AGENT_PACE=0 turns it off.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Payload, PaceNotes } from "./agent-pace/notes";

export default function agentPace(pi: ExtensionAPI) {
	if (process.env.OMP_AGENT_PACE === "0") return;
	const notes = new PaceNotes();
	pi.on("agent_start", () => notes.start());
	pi.on("before_provider_request", event => {
		const payload = event.payload as Payload | null;
		return payload && notes.apply(payload) ? payload : undefined;
	});
}
