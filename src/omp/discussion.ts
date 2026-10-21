/** **Ask about this**'s model call: one request through omp's model registry, with no tools, that no session sees. */
import { errorText } from "../json";
import { HOME } from "../paths";
import { DISCUSSION_SYSTEM_PROMPT, type DiscussionEvent, type DiscussionRequest, discussionPrompt } from "../shared/discussions";
import { auth, config, modelRegistry, modelResolver, piStream } from "./modules";

/** The roles an answer comes from, the first that names a model you can call: the cheap one, else the one sessions start on. */
const ROLES = ["smol", "default"];
/** Room for a long answer; reasoning is off, so none of it goes to thinking. */
const MAX_ANSWER_TOKENS = 4096;

/**
 * Answers `request` with the model of omp's `smol` role, else of its `default` role, from the user-level config.
 * `emit` gets the model, the answer's text as it streams, then always one `end`; an aborted `signal` ends it with no error.
 */
export async function answerDiscussion(request: DiscussionRequest, signal: AbortSignal, emit: (event: DiscussionEvent) => void): Promise<void> {
	try {
		await streamAnswer(request, signal, emit);
		emit({ kind: "end", error: null });
	} catch (error) {
		emit({ kind: "end", error: signal.aborted ? null : errorText(error) });
	}
}

async function streamAnswer(request: DiscussionRequest, signal: AbortSignal, emit: (event: DiscussionEvent) => void): Promise<void> {
	const settings = await config.Settings.loadReadOnly({ cwd: HOME });
	const storage = await auth.discoverAuthStorage();
	try {
		const registry = new modelRegistry.ModelRegistry(storage);
		await registry.refresh();
		const picked = modelResolver.resolveRoleSelection(ROLES, settings, registry.getAvailable());
		if (!picked) throw new Error("No model you can call is set for omp's smol or default role.");
		const { model } = picked;
		const name = `${model.provider}/${model.id}`;
		if (!(await registry.getApiKey(model))) throw new Error(`omp has no key for ${name}.`);
		emit({ kind: "model", model: name });
		const events = piStream.streamSimple(
			model,
			{ systemPrompt: [DISCUSSION_SYSTEM_PROMPT], messages: [{ role: "user", content: discussionPrompt(request), timestamp: Date.now() }] },
			{ apiKey: registry.resolver(model), maxTokens: MAX_ANSWER_TOKENS, disableReasoning: true, signal },
		);
		for await (const event of events) {
			if (event.type === "text_delta" && event.delta) emit({ kind: "text", text: event.delta });
			else if (event.type === "error") {
				if (event.reason === "aborted") return;
				throw new Error(event.error?.errorMessage || `${name} could not answer.`);
			}
		}
	} finally {
		storage.close();
	}
}
