import { expect, test } from "bun:test";
import { CommandError } from "./agent/extensions/github/command";
import { type Exec, GhRunner } from "./agent/extensions/github/runner";

/** A fake gh that sleeps far past the timeout, and an exec that kills it on abort the way pi.exec does, or never reports when `hang` is set. */
function sleepingGh(hang: boolean): Exec {
	return async (_command, _args, { signal }) => {
		const child = Bun.spawn(["sleep", "60"], { stdout: "pipe", stderr: "pipe" });
		signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
		await child.exited;
		if (hang) await new Promise(() => {});
		return { code: -1, stdout: "", stderr: "", killed: true };
	};
}

for (const hang of [false, true]) {
	test(`a gh that outlives the timeout fails promptly with a timed-out message${hang ? " even when exec never reports" : ""}`, async () => {
		const started = Date.now();
		const error = await new GhRunner(sleepingGh(hang), 500).text(["pr", "view", "12", "--json", "body"], "/").catch(e => e);
		expect(error).toBeInstanceOf(CommandError);
		expect(error.message).toBe("gh pr view timed out after 1s");
		expect(Date.now() - started).toBeLessThan(4_000);
	});
}
