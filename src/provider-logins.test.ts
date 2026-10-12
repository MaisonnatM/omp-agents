import { describe, expect, test, vi } from "bun:test";
import type { LoginHooks } from "./omp/providers";
import { createProviderLogins, type RunLogin } from "./provider-logins";

/** A sign-in the test drives: each call records its hooks and settles when the test says. */
function scripted() {
	const calls: { method: string; hooks: LoginHooks; done: PromiseWithResolvers<string | null> }[] = [];
	const run: RunLogin = (method, _provider, hooks) => {
		const done = Promise.withResolvers<string | null>();
		calls.push({ method, hooks, done });
		return done.promise;
	};
	return { run, calls };
}

describe("provider logins", () => {
	test("shows the page to open and the question, then the account the answer stored", async () => {
		const { run, calls } = scripted();
		const logins = createProviderLogins(run);
		logins.start("anthropic", "anthropic");
		const [{ hooks, done }] = calls;
		hooks.onAuth({ url: "https://claude.ai/oauth", instructions: "Sign in" });
		const answered = hooks.onPrompt({ message: "Paste the code", secret: true });
		expect(logins.state()).toMatchObject({ phase: "running", url: "https://claude.ai/oauth", instructions: "Sign in", prompt: { message: "Paste the code", secret: true, allowEmpty: false } });

		const state = logins.state();
		const promptId = state?.phase === "running" ? state.prompt!.id : -1;
		expect(logins.answer(promptId + 1, "wrong")).toBe(false);
		expect(logins.answer(promptId, "code#state")).toBe(true);
		expect(await answered).toBe("code#state");
		expect(logins.answer(promptId, "again")).toBe(false);

		done.resolve("me@example.com");
		await done.promise;
		expect(logins.state()).toEqual({ provider: "anthropic", method: "anthropic", phase: "done", identity: "me@example.com" });
	});

	test("a failed sign-in keeps its error until dismissed", async () => {
		const { run, calls } = scripted();
		const logins = createProviderLogins(run);
		logins.start("deepseek", "deepseek");
		calls[0]!.done.reject(new Error("Invalid API key"));
		await calls[0]!.done.promise.catch(() => {});
		expect(logins.state()).toMatchObject({ phase: "failed", error: "Invalid API key" });
		logins.cancel();
		expect(logins.state()).toBeNull();
	});

	test("cancelling rejects the open question, aborts the flow, and ignores what it does after", async () => {
		const { run, calls } = scripted();
		const logins = createProviderLogins(run);
		logins.start("openai-codex", "openai-codex");
		const [{ hooks, done }] = calls;
		const answered = hooks.onPrompt({ message: "Paste the code" });
		logins.cancel();
		expect(hooks.signal.aborted).toBe(true);
		await expect(answered).rejects.toThrow("Sign-in cancelled.");
		expect(logins.state()).toBeNull();
		done.resolve("late@example.com");
		await done.promise;
		expect(logins.state()).toBeNull();
	});

	test("a new sign-in abandons the one under way", async () => {
		const { run, calls } = scripted();
		const logins = createProviderLogins(run);
		logins.start("openai-codex", "openai-codex");
		logins.start("openai-codex", "openai-codex-device");
		expect(calls[0]!.hooks.signal.aborted).toBe(true);
		calls[0]!.done.reject(new Error("aborted"));
		await calls[0]!.done.promise.catch(() => {});
		expect(logins.state()).toMatchObject({ phase: "running", method: "openai-codex-device" });
	});

	test("a sign-in that outlasts its time fails, even when the flow never settles", async () => {
		vi.useFakeTimers();
		const { run, calls } = scripted();
		const logins = createProviderLogins(run);
		logins.start("github-copilot", "github-copilot");
		const answered = calls[0]!.hooks.onPrompt({ message: "Enterprise domain", allowEmpty: true });
		vi.advanceTimersByTime(5 * 60_000);
		vi.useRealTimers();
		expect(logins.state()).toMatchObject({ phase: "failed", error: "The sign-in was not completed within 5 minutes. Try again." });
		expect(calls[0]!.hooks.signal.aborted).toBe(true);
		await expect(answered).rejects.toThrow();
	});
});
